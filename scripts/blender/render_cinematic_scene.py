import bpy
import hashlib
import importlib.util
import json
import math
import os
import random
import sys
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector


fixture_modulation_reports = []
production_character_reports = []
mpfb_module_name = None
WORLD_OUTPUT_NODE = "videoer-world-output"
WORLD_BACKGROUND_NODE = "videoer-world-background"
WORLD_VOLUME_NODE = "videoer-world-volume"
WORLD_COORDINATE_NODE = "videoer-world-coordinate"
WORLD_DIRECTION_SCALE_NODE = "videoer-world-direction-scale"
WORLD_VECTOR_ROTATE_NODE = "videoer-world-vector-rotate"
WORLD_ENVIRONMENT_NODE = "videoer-world-environment"
FOG_OBJECT_NAME = "videoer-finite-fog-domain"
FOG_MATERIAL_NAME = "videoer-finite-fog-material"
world_configuration_report = None
color_management_report = None


def load_module(filename, name):
    path = os.path.join(os.path.dirname(__file__), filename)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def arguments():
    if "--" not in sys.argv:
        raise RuntimeError("Expected cinematic manifest and output after --")
    values = sys.argv[sys.argv.index("--") + 1 :]
    if len(values) not in (2, 3):
        raise RuntimeError(
            "Usage: render_cinematic_scene.py -- scene.json output [render|probe|inspect-only]"
        )
    mode = values[2] if len(values) == 3 else "render"
    if mode not in ("render", "probe", "inspect-only"):
        raise RuntimeError(f"Unsupported cinematic Blender mode: {mode}")
    return values[0], values[1], mode


def load_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def to_blender(value):
    return Vector(geometry_probe.to_blender(value))


def create_entity(definition, fps, duration):
    global mpfb_module_name
    asset = load_json(definition["geometryPath"])
    rig_profile_path = definition.get("productionRigProfilePath")
    if rig_profile_path:
        motion_binding = definition.get("motion")
        if not motion_binding:
            raise RuntimeError(
                f"Production-rig entity '{definition['id']}' requires a canonical motion binding"
            )
        profile = load_json(rig_profile_path)
        if profile.get("backend") != "blender-rigify":
            raise RuntimeError(
                f"Production-rig entity '{definition['id']}' requires a Blender Rigify profile"
            )
        if mpfb_module_name is None:
            mpfb_module_name = rigify_adapter.enable_backends()
        armature, mesh = rigify_adapter.create_rigged_human(
            mpfb_module_name, asset, clear_scene=False
        )
        armature.name = definition["id"]
        mesh.name = f"{definition['id']}-mesh"
        assembly_objects = []
        if definition.get("productionCharacterBindingPath"):
            assembly_objects, assembly_report = production_character_assembly.assemble(
                definition, asset, armature, mesh, profile, geometry_probe
            )
            production_character_reports.append(assembly_report)
        motion = load_json(motion_binding["path"])
        rigify_adapter.apply_canonical_motion(
            armature,
            asset,
            motion,
            fps,
            profile,
            motion_binding.get("startSeconds", 0),
            motion_binding.get("endSeconds", duration),
            motion_binding.get("sourceStartSeconds", 0),
            motion_binding.get("sourceEndSeconds", motion["durationSeconds"]),
            False,
        )
        bpy.context.view_layer.objects.active = armature
        armature.select_set(True)
        if armature.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        # MPFB's authored body faces Blender -Y while a canonical identity
        # entity faces Blender +Y. Align that local basis before applying the
        # ordinary renderer-independent semantic entity transform.
        world = interaction_probe.scene_matrix(definition["transform"])
        backend_alignment = Matrix.Rotation(math.pi, 4, "Z")
        armature.matrix_world = world @ backend_alignment
        if mesh.parent != armature:
            mesh.matrix_world = world @ backend_alignment
        armature.hide_render = not definition.get("visible", True)
        mesh.hide_render = not definition.get("visible", True)
        for assembly_object in assembly_objects:
            assembly_object.hide_render = not definition.get("visible", True)
        return asset, armature, mesh
    armature = geometry_probe.create_armature(asset)
    armature.name = definition["id"]
    mesh = geometry_probe.create_mesh(asset, armature, os.path.dirname(definition["geometryPath"]))
    mesh.name = f"{definition['id']}-mesh"
    armature.matrix_world = interaction_probe.scene_matrix(definition["transform"])
    armature.hide_render = not definition.get("visible", True)
    motion_binding = definition.get("motion")
    if motion_binding:
        motion = load_json(motion_binding["path"])
        motion_probe.apply_motion(
            armature,
            asset,
            motion,
            fps,
            motion_binding.get("startSeconds", 0),
            motion_binding.get("endSeconds", duration),
            motion_binding.get("sourceStartSeconds", 0),
            motion_binding.get("sourceEndSeconds", motion["durationSeconds"]),
            True,
            mesh,
        )
    return asset, armature, mesh


def point_object(obj, target):
    obj.rotation_euler = (to_blender(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def create_camera(scene, definition, fps):
    data = bpy.data.cameras.new("cinematic-camera")
    camera = bpy.data.objects.new("cinematic-camera", data)
    target = bpy.data.objects.new("cinematic-camera-target", None)
    bpy.context.collection.objects.link(camera)
    bpy.context.collection.objects.link(target)
    scene.camera = camera
    duration = definition["keyframes"][-1]["time"]
    for frame in range(1, scene.frame_end + 1):
        time = ((frame - 1) / (scene.frame_end - 1)) * duration
        sampled = sample_semantic_camera(definition, time)
        camera.location = to_blender(sampled["position"])
        target.location = to_blender(sampled["target"])
        camera.data.lens = sampled["lensMillimeters"]
        camera.keyframe_insert(data_path="location", frame=frame)
        target.keyframe_insert(data_path="location", frame=frame)
        camera.data.keyframe_insert(data_path="lens", frame=frame)
    tracking = camera.constraints.new(type="TRACK_TO")
    tracking.name = "semantic-camera-target"
    tracking.target = target
    tracking.track_axis = "TRACK_NEGATIVE_Z"
    tracking.up_axis = "UP_Y"
    for action_owner in (camera, target, camera.data):
        action = action_owner.animation_data.action if action_owner.animation_data else None
        if action:
            for curve in action.fcurves:
                for point in curve.keyframe_points:
                    point.interpolation = "LINEAR"
    return camera


def sample_semantic_camera(definition, time):
    keyframes = definition["keyframes"]
    end_index = next(
        (index for index, keyframe in enumerate(keyframes) if keyframe["time"] >= time),
        len(keyframes) - 1,
    )
    if end_index == 0:
        return keyframes[0]
    start = keyframes[end_index - 1]
    end = keyframes[end_index]
    progress = (time - start["time"]) / (end["time"] - start["time"])
    if start.get("easing", "ease-in-out") == "ease-in-out":
        progress = 0.5 - math.cos(math.pi * progress) / 2

    def interpolate(first, second):
        if isinstance(first, list):
            return [a + (b - a) * progress for a, b in zip(first, second)]
        return first + (second - first) * progress

    return {
        "position": interpolate(start["position"], end["position"]),
        "target": interpolate(start["target"], end["target"]),
        "lensMillimeters": interpolate(start["lensMillimeters"], end["lensMillimeters"]),
    }


def create_lights(definitions, entity_meshes):
    reports = []
    for definition in definitions:
        light_type = definition["type"].upper()
        bpy.ops.object.light_add(type=light_type, location=to_blender(definition["position"]))
        light = bpy.context.object
        light.name = definition["id"]
        light.data.energy = definition["energy"]
        light.data.color = definition["color"]
        if hasattr(light.data, "shape") and light_type == "AREA":
            light.data.shape = "DISK"
            light.data.size = definition.get("sizeMeters", 1)
        if light_type == "SPOT":
            light.data.spot_size = math.radians(definition.get("angleDegrees", 45))
        if definition.get("target"):
            point_object(light, definition["target"])
        modulation = definition.get("temporalModulation")
        if modulation:
            source_material = None
            emission_strength_socket = None
            emission_color_socket = None
            base_emission_strength = None
            source_binding = definition.get("visibleSourceBinding")
            if source_binding:
                source_mesh = entity_meshes.get(source_binding["entityId"])
                if source_mesh is None:
                    raise RuntimeError(
                        f"Temporal light '{definition['id']}' references missing source entity "
                        f"'{source_binding['entityId']}'"
                    )
                source_material = next(
                    (
                        material
                        for material in source_mesh.data.materials
                        if material.name == source_binding["materialId"]
                    ),
                    None,
                )
                if source_material is None:
                    raise RuntimeError(
                        f"Temporal light '{definition['id']}' references missing source material "
                        f"'{source_binding['materialId']}' on '{source_binding['entityId']}'"
                    )
                if source_material.use_nodes:
                    source_principled = source_material.node_tree.nodes.get("Principled BSDF")
                    if source_principled:
                        emission_strength_socket = source_principled.inputs.get("Emission Strength")
                        emission_color_socket = (
                            source_principled.inputs.get("Emission Color")
                            or source_principled.inputs.get("Emission")
                        )
                        if emission_strength_socket:
                            base_emission_strength = emission_strength_socket.default_value
                if base_emission_strength is None:
                    raise RuntimeError(
                        f"Temporal light '{definition['id']}' source material has no emission strength"
                    )
            samples = []
            for frame in range(1, bpy.context.scene.frame_end + 1):
                sample = temporal_light_sample(
                    modulation,
                    definition["color"],
                    definition["energy"],
                    frame,
                    bpy.context.scene.render.fps,
                )
                light.data.energy = sample["powerWatts"]
                light.data.color = sample["lightColor"]
                light.data.keyframe_insert(data_path="energy", frame=frame)
                light.data.keyframe_insert(data_path="color", frame=frame)
                if emission_strength_socket and base_emission_strength is not None:
                    emission_strength_socket.default_value = (
                        base_emission_strength * sample["intensityMultiplier"]
                    )
                    emission_strength_socket.keyframe_insert(
                        data_path="default_value", frame=frame
                    )
                    sample["sourceEmissionStrength"] = emission_strength_socket.default_value
                else:
                    sample["sourceEmissionStrength"] = None
                if emission_color_socket and modulation["kind"] == "seeded-flicker":
                    emission_color_socket.default_value = (*sample["lightColor"], 1)
                    emission_color_socket.keyframe_insert(data_path="default_value", frame=frame)
                samples.append(sample)
            for action_owner in (light.data, source_material.node_tree if source_material else None):
                action = (
                    action_owner.animation_data.action
                    if action_owner and action_owner.animation_data
                    else None
                )
                if action:
                    for curve in action.fcurves:
                        for point in curve.keyframe_points:
                            point.interpolation = "LINEAR"
            reports.append({
                "lightId": definition["id"],
                "temporalSignalId": definition.get("temporalSignalId"),
                "visibleSourceRole": definition.get("visibleSourceRole"),
                "visibleSourceBinding": source_binding,
                "kind": modulation["kind"],
                "seed": modulation["seed"],
                "frequencyHz": modulation["frequencyHz"],
                "declaredIntensityRange": [
                    modulation["intensityMinimumMultiplier"],
                    modulation["intensityMaximumMultiplier"],
                ],
                "declaredColorTemperatureRangeKelvin": (
                    [
                        modulation["colorTemperatureMinimumKelvin"],
                        modulation["colorTemperatureMaximumKelvin"],
                    ]
                    if modulation["kind"] == "seeded-flicker"
                    else None
                ),
                "baseEnergy": definition["energy"],
                "baseColor": definition["color"],
                "samples": samples,
            })
    return reports


def smooth_seeded_modulation(seed, position):
    index = math.floor(position)
    progress = position - index
    progress = progress * progress * (3 - 2 * progress)
    first = random.Random(seed + index * 104729).random()
    second = random.Random(seed + (index + 1) * 104729).random()
    return first + (second - first) * progress


def smooth_seeded_electrical_modulation(modulation, position):
    index = math.floor(position)
    progress = position - index
    progress = progress * progress * (3 - 2 * progress)

    def node_value(node_index):
        generator = random.Random(modulation["seed"] + node_index * 104729)
        if generator.random() < modulation["dropoutProbability"]:
            return modulation["intensityMinimumMultiplier"]
        return (
            modulation["intensityMinimumMultiplier"]
            + (modulation["intensityMaximumMultiplier"] - modulation["intensityMinimumMultiplier"])
            * generator.random()
        )

    first = node_value(index)
    second = node_value(index + 1)
    return first + (second - first) * progress


def blackbody_rgb(kelvin):
    temperature = max(1000, min(12000, kelvin)) / 100
    red = 255 if temperature <= 66 else 329.698727446 * ((temperature - 60) ** -0.1332047592)
    green = (
        99.4708025861 * math.log(temperature) - 161.1195681661
        if temperature <= 66
        else 288.1221695283 * ((temperature - 60) ** -0.0755148492)
    )
    blue = (
        0
        if temperature <= 19
        else 255
        if temperature >= 66
        else 138.5177312231 * math.log(temperature - 10) - 305.044792731
    )
    return tuple(max(0, min(255, value)) / 255 for value in (red, green, blue))


def temporal_light_sample(modulation, base_color, base_energy, frame, fps):
    time = (frame - 1) / fps
    if modulation["kind"] == "seeded-electrical-instability":
        multiplier = smooth_seeded_electrical_modulation(
            modulation, time * modulation["frequencyHz"]
        )
        kelvin = None
        color = tuple(base_color)
    else:
        amount = smooth_seeded_modulation(
            modulation["seed"], time * modulation["frequencyHz"]
        )
        multiplier = (
            modulation["intensityMinimumMultiplier"]
            + (
                modulation["intensityMaximumMultiplier"]
                - modulation["intensityMinimumMultiplier"]
            )
            * amount
        )
        kelvin = (
            modulation["colorTemperatureMinimumKelvin"]
            + (
                modulation["colorTemperatureMaximumKelvin"]
                - modulation["colorTemperatureMinimumKelvin"]
            )
            * amount
        )
        color = blackbody_rgb(kelvin)
    return {
        "frame": frame,
        "timeSeconds": time,
        "intensityMultiplier": multiplier,
        "powerWatts": base_energy * multiplier,
        "colorTemperatureKelvin": kelvin,
        "lightColor": list(color),
    }


def create_fixture_lights(definition, entity_id, asset, armature, mesh):
    fixture = load_json(definition["fixturePath"])
    if fixture["geometryAssetId"] != asset["id"]:
        raise RuntimeError(
            f"Fixture '{fixture['id']}' expects geometry '{fixture['geometryAssetId']}', "
            f"received '{asset['id']}'"
        )
    if fixture["mountAttachmentId"] not in asset.get("attachments", {}):
        raise RuntimeError(
            f"Fixture '{fixture['id']}' references missing mount attachment "
            f"'{fixture['mountAttachmentId']}'"
        )
    for emitter in fixture["emitters"]:
        light_type = emitter["type"].upper()
        bpy.ops.object.light_add(type=light_type, location=(0, 0, 0))
        light = bpy.context.object
        light.name = f"{entity_id}--{emitter['id']}"
        light.parent = armature
        light.location = to_blender(emitter["position"])
        light.data.energy = emitter["powerWatts"]
        light.data.color = emitter["color"]
        if light_type == "AREA":
            light.data.shape = "DISK"
            light.data.size = emitter.get("sizeMeters", 0.08)
        elif light_type == "POINT" and hasattr(light.data, "shadow_soft_size"):
            light.data.shadow_soft_size = emitter.get("sizeMeters", 0.08)
        if light_type == "SPOT":
            light.data.spot_size = math.radians(emitter.get("angleDegrees", 45))
            light.data.shadow_soft_size = emitter.get("sizeMeters", 0.08)
        if emitter.get("target"):
            target = bpy.data.objects.new(f"{light.name}--target", None)
            bpy.context.collection.objects.link(target)
            target.parent = armature
            target.location = to_blender(emitter["target"])
            tracking = light.constraints.new(type="TRACK_TO")
            tracking.target = target
            tracking.track_axis = "TRACK_NEGATIVE_Z"
            tracking.up_axis = "UP_Y"
        modulation = emitter.get("temporalModulation")
        if modulation:
            source_material = None
            source_material_id = emitter.get("visibleSourceMaterialId")
            if source_material_id:
                source_material = next(
                    (material for material in mesh.data.materials if material.name == source_material_id),
                    None,
                )
                if source_material is None:
                    raise RuntimeError(
                        f"Fixture emitter '{emitter['id']}' references missing visible source material "
                        f"'{source_material_id}'"
                    )
            base_emission_strength = None
            emission_strength_socket = None
            emission_color_socket = None
            if source_material and source_material.use_nodes:
                source_principled = source_material.node_tree.nodes.get("Principled BSDF")
                if source_principled:
                    emission_strength_socket = source_principled.inputs.get("Emission Strength")
                    emission_color_socket = (
                        source_principled.inputs.get("Emission Color")
                        or source_principled.inputs.get("Emission")
                    )
                    if emission_strength_socket:
                        base_emission_strength = emission_strength_socket.default_value
            samples = []
            for frame in range(1, bpy.context.scene.frame_end + 1):
                time = (frame - 1) / bpy.context.scene.render.fps
                if modulation["kind"] == "seeded-electrical-instability":
                    multiplier = smooth_seeded_electrical_modulation(
                        modulation, time * modulation["frequencyHz"]
                    )
                    kelvin = None
                    color = tuple(emitter["color"])
                else:
                    amount = smooth_seeded_modulation(
                        modulation["seed"], time * modulation["frequencyHz"]
                    )
                    multiplier = (
                        modulation["intensityMinimumMultiplier"]
                        + (
                            modulation["intensityMaximumMultiplier"]
                            - modulation["intensityMinimumMultiplier"]
                        )
                        * amount
                    )
                    kelvin = (
                        modulation["colorTemperatureMinimumKelvin"]
                        + (
                            modulation["colorTemperatureMaximumKelvin"]
                            - modulation["colorTemperatureMinimumKelvin"]
                        )
                        * amount
                    )
                    color = blackbody_rgb(kelvin)
                light.data.energy = emitter["powerWatts"] * multiplier
                light.data.color = color
                light.data.keyframe_insert(data_path="energy", frame=frame)
                light.data.keyframe_insert(data_path="color", frame=frame)
                if emission_strength_socket and base_emission_strength is not None:
                    emission_strength_socket.default_value = base_emission_strength * multiplier
                    emission_strength_socket.keyframe_insert(
                        data_path="default_value", frame=frame
                    )
                if emission_color_socket and modulation["kind"] == "seeded-flicker":
                    emission_color_socket.default_value = (*color, 1)
                    emission_color_socket.keyframe_insert(data_path="default_value", frame=frame)
                samples.append({
                    "frame": frame,
                    "timeSeconds": time,
                    "intensityMultiplier": multiplier,
                    "powerWatts": light.data.energy,
                    "colorTemperatureKelvin": kelvin,
                    "lightColor": list(color),
                    "sourceEmissionStrength": (
                        emission_strength_socket.default_value
                        if emission_strength_socket
                        else None
                    ),
                })
            for action_owner in (light.data, source_material.node_tree if source_material else None):
                action = (
                    action_owner.animation_data.action
                    if action_owner and action_owner.animation_data
                    else None
                )
                if action:
                    for curve in action.fcurves:
                        for point in curve.keyframe_points:
                            point.interpolation = "LINEAR"
            fixture_modulation_reports.append({
                "entityId": entity_id,
                "fixtureId": fixture["id"],
                "emitterId": emitter["id"],
                "kind": modulation["kind"],
                "seed": modulation["seed"],
                "frequencyHz": modulation["frequencyHz"],
                "declaredIntensityRange": [
                    modulation["intensityMinimumMultiplier"],
                    modulation["intensityMaximumMultiplier"],
                ],
                "declaredColorTemperatureRangeKelvin": (
                    [
                        modulation["colorTemperatureMinimumKelvin"],
                        modulation["colorTemperatureMaximumKelvin"],
                    ]
                    if modulation["kind"] == "seeded-flicker"
                    else None
                ),
                "dropoutProbability": modulation.get("dropoutProbability"),
                "visibleSourceMaterialId": source_material_id,
                "samples": samples,
            })


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_environment_illumination(environment):
    if not isinstance(environment, dict):
        raise RuntimeError("Environment illumination must be an object")
    if environment.get("kind") != "hash-bound-equirectangular-radiance":
        raise RuntimeError(
            f"Unsupported environment illumination kind: {environment.get('kind')}"
        )
    source = environment.get("source")
    if not isinstance(source, dict):
        raise RuntimeError("Environment illumination source binding is missing")
    media_type = source.get("mediaType")
    expected_blender_format = {
        "image/vnd.radiance": "HDR",
        "image/x-exr": "OPEN_EXR",
    }.get(media_type)
    if expected_blender_format is None:
        raise RuntimeError(
            f"Unsupported environment illumination media type: {media_type}"
        )
    if environment.get("colorSpace") != "scene-linear-rec709":
        raise RuntimeError("Environment illumination must declare scene-linear-rec709")
    if environment.get("projection") != "equirectangular":
        raise RuntimeError("Environment illumination must use equirectangular projection")
    path = source.get("path")
    if not isinstance(path, str) or not os.path.isabs(path):
        raise RuntimeError("Resolved environment illumination source path must be absolute")
    if not os.path.isfile(path):
        raise RuntimeError(f"Environment illumination source is missing: {path}")
    expected_size = source.get("sizeBytes")
    if not isinstance(expected_size, int) or isinstance(expected_size, bool) or expected_size <= 0:
        raise RuntimeError("Environment illumination source byte size is invalid")
    actual_size = os.path.getsize(path)
    if actual_size != expected_size:
        raise RuntimeError(
            f"Environment illumination byte size mismatch: expected {expected_size}, got {actual_size}"
        )
    expected_hash = source.get("sha256")
    if (
        not isinstance(expected_hash, str)
        or len(expected_hash) != 64
        or any(character not in "0123456789abcdef" for character in expected_hash)
    ):
        raise RuntimeError("Environment illumination SHA-256 binding is invalid")
    actual_hash = sha256_file(path)
    if actual_hash != expected_hash:
        raise RuntimeError(
            f"Environment illumination SHA-256 mismatch: expected {expected_hash}, got {actual_hash}"
        )
    dimensions = environment.get("dimensions")
    if not isinstance(dimensions, dict):
        raise RuntimeError("Environment illumination dimensions are missing")
    width = dimensions.get("widthPixels")
    height = dimensions.get("heightPixels")
    if (
        not isinstance(width, int)
        or isinstance(width, bool)
        or not isinstance(height, int)
        or isinstance(height, bool)
        or width <= 0
        or height <= 0
        or width > 65536
        or height > 32768
        or width != height * 2
    ):
        raise RuntimeError("Environment illumination dimensions must be bounded exact 2:1 integers")
    yaw = environment.get("yawDegrees", 0)
    exposure = environment.get("exposureStops", 0)
    if not isinstance(yaw, (int, float)) or not math.isfinite(yaw) or yaw < -180 or yaw > 180:
        raise RuntimeError("Environment illumination yaw must be within -180 to 180 degrees")
    if (
        not isinstance(exposure, (int, float))
        or not math.isfinite(exposure)
        or exposure < -6
        or exposure > 6
    ):
        raise RuntimeError("Environment illumination exposure must be within -6 to 6 stops")
    return {
        "path": path,
        "sha256": actual_hash,
        "sizeBytes": actual_size,
        "mediaType": media_type,
        "expectedBlenderFormat": expected_blender_format,
        "widthPixels": width,
        "heightPixels": height,
        "yawDegrees": yaw,
        "exposureStops": exposure,
    }


def configure_world(scene, color, strength=1.0, environment_illumination=None):
    if (
        not isinstance(color, (list, tuple))
        or len(color) != 3
        or not all(isinstance(value, (int, float)) and math.isfinite(value) and value >= 0 for value in color)
    ):
        raise RuntimeError("Cinematic world color must contain three finite non-negative channels")
    if not isinstance(strength, (int, float)) or not math.isfinite(strength) or strength < 0:
        raise RuntimeError("Cinematic world strength must be finite and non-negative")
    if scene.world is None:
        scene.world = bpy.data.worlds.new("videoer-cinematic-world")
    world = scene.world
    world.color = color
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputWorld")
    output.name = WORLD_OUTPUT_NODE
    output.label = "Videoer world output"
    background = nodes.new("ShaderNodeBackground")
    background.name = WORLD_BACKGROUND_NODE
    background.label = "Videoer declared atmosphere"
    background.inputs["Color"].default_value = (*color, 1)
    background.inputs["Strength"].default_value = strength
    links.new(background.outputs["Background"], output.inputs["Surface"])
    report = {
        "surfaceKind": "flat-color",
        "color": list(color),
        "strength": strength,
        "surfaceLinked": True,
        "volumeLinked": False,
    }
    if environment_illumination is None:
        return report

    validated = validate_environment_illumination(environment_illumination)
    image = bpy.data.images.load(validated["path"], check_existing=False)
    if tuple(image.size) != (validated["widthPixels"], validated["heightPixels"]):
        bpy.data.images.remove(image)
        raise RuntimeError(
            "Decoded environment illumination dimensions do not match the declared binding"
        )
    decoded_format = image.file_format
    if decoded_format != validated["expectedBlenderFormat"]:
        bpy.data.images.remove(image)
        raise RuntimeError(
            "Decoded environment illumination format does not match its declared media type: "
            f"got {decoded_format}, expected {validated['expectedBlenderFormat']}"
        )
    try:
        image.colorspace_settings.name = "Linear Rec.709"
    except TypeError as error:
        bpy.data.images.remove(image)
        raise RuntimeError("Blender lacks the required Linear Rec.709 input color space") from error
    coordinate = nodes.new("ShaderNodeNewGeometry")
    coordinate.name = WORLD_COORDINATE_NODE
    coordinate.label = "Videoer World incoming direction"
    direction_scale = nodes.new("ShaderNodeVectorMath")
    direction_scale.name = WORLD_DIRECTION_SCALE_NODE
    direction_scale.label = "Videoer outward environment direction"
    direction_scale.operation = "SCALE"
    direction_scale.inputs["Scale"].default_value = -1
    vector_rotate = nodes.new("ShaderNodeVectorRotate")
    vector_rotate.name = WORLD_VECTOR_ROTATE_NODE
    vector_rotate.label = "Videoer environment yaw"
    vector_rotate.rotation_type = "AXIS_ANGLE"
    vector_rotate.invert = False
    vector_rotate.inputs["Axis"].default_value = (0, 0, 1)
    vector_rotate.inputs["Angle"].default_value = math.radians(validated["yawDegrees"])
    texture = nodes.new("ShaderNodeTexEnvironment")
    texture.name = WORLD_ENVIRONMENT_NODE
    texture.label = "Videoer hash-bound radiance"
    texture.image = image
    texture.projection = "EQUIRECTANGULAR"
    texture.interpolation = "Linear"
    background.inputs["Strength"].default_value = 2 ** validated["exposureStops"]
    links.new(coordinate.outputs["Incoming"], direction_scale.inputs["Vector"])
    links.new(direction_scale.outputs["Vector"], vector_rotate.inputs["Vector"])
    links.new(vector_rotate.outputs["Vector"], texture.inputs["Vector"])
    links.new(texture.outputs["Color"], background.inputs["Color"])
    world.cycles.sampling_method = "AUTOMATIC"
    report.update({
        "surfaceKind": "hash-bound-equirectangular-radiance",
        "strength": background.inputs["Strength"].default_value,
        "source": {
            "path": validated["path"],
            "sha256": validated["sha256"],
            "sizeBytes": validated["sizeBytes"],
            "mediaType": validated["mediaType"],
        },
        "colorSpace": image.colorspace_settings.name,
        "decodedBlenderFormat": decoded_format,
        "projection": "equirectangular",
        "dimensions": {
            "widthPixels": validated["widthPixels"],
            "heightPixels": validated["heightPixels"],
        },
        "yawDegrees": validated["yawDegrees"],
        "yawRadiansBlenderZ": vector_rotate.inputs["Angle"].default_value,
        "coordinateOutput": "negated-Incoming",
        "directionScale": direction_scale.inputs["Scale"].default_value,
        "vectorInputLinked": texture.inputs["Vector"].is_linked,
        "exposureStops": validated["exposureStops"],
        "cyclesSamplingMethod": world.cycles.sampling_method,
    })
    return report


def canonical_bounds_to_blender(bounds_minimum, bounds_maximum):
    corners = [
        to_blender((x, y, z))
        for x in (bounds_minimum[0], bounds_maximum[0])
        for y in (bounds_minimum[1], bounds_maximum[1])
        for z in (bounds_minimum[2], bounds_maximum[2])
    ]
    minimum = [min(point[axis] for point in corners) for axis in range(3)]
    maximum = [max(point[axis] for point in corners) for axis in range(3)]
    return minimum, maximum


def from_blender(value):
    return [value[0], value[2], -value[1]]


def evaluated_fog_domain(scene, domain):
    policy = domain.get("requestedPolicy")
    if not isinstance(policy, dict) or policy.get("policy") not in (
        "scene-envelope-v1",
        "explicit-box-v1",
    ):
        raise RuntimeError("Finite fog domain lacks its requested renderer-independent policy")
    original_frame = scene.frame_current
    sampled_frames = list(range(scene.frame_start, scene.frame_end + 1))
    visible_meshes = sorted(
        (
            obj
            for obj in scene.objects
            if obj.type == "MESH" and not obj.hide_render and obj.name != FOG_OBJECT_NAME
        ),
        key=lambda obj: obj.name,
    )
    minimum = [math.inf, math.inf, math.inf]
    maximum = [-math.inf, -math.inf, -math.inf]
    evaluated_point_count = 0

    def include(point):
        nonlocal evaluated_point_count
        canonical = from_blender(point)
        for axis in range(3):
            minimum[axis] = min(minimum[axis], canonical[axis])
            maximum[axis] = max(maximum[axis], canonical[axis])
        evaluated_point_count += 1

    target = bpy.data.objects.get("cinematic-camera-target")
    try:
        for frame in sampled_frames:
            scene.frame_set(frame)
            dependency_graph = bpy.context.evaluated_depsgraph_get()
            for obj in visible_meshes:
                evaluated = obj.evaluated_get(dependency_graph)
                for corner in evaluated.bound_box:
                    include(evaluated.matrix_world @ Vector(corner))
            if scene.camera is not None:
                include(scene.camera.matrix_world.translation)
            if target is not None:
                include(target.matrix_world.translation)
    finally:
        scene.frame_set(original_frame)
    if not evaluated_point_count:
        raise RuntimeError("Finite fog domain has no evaluated render points")

    if policy["policy"] == "scene-envelope-v1":
        horizontal_padding = policy.get("horizontalPaddingMeters")
        below_padding = policy.get("belowPaddingMeters")
        above_padding = policy.get("abovePaddingMeters")
        minimum_horizontal = policy.get("minimumHorizontalSpanMeters")
        minimum_vertical = policy.get("minimumVerticalSpanMeters")
        values = (
            horizontal_padding,
            below_padding,
            above_padding,
            minimum_horizontal,
            minimum_vertical,
        )
        if not all(isinstance(value, (int, float)) and value >= 0 for value in values):
            raise RuntimeError("Finite fog scene-envelope parameters are invalid")

        def symmetric_axis(axis, minimum_span, padding):
            center = (minimum[axis] + maximum[axis]) / 2
            span = max(maximum[axis] - minimum[axis], minimum_span)
            return center - span / 2 - padding, center + span / 2 + padding

        x = symmetric_axis(0, minimum_horizontal, horizontal_padding)
        vertical_center = (minimum[1] + maximum[1]) / 2
        vertical_span = max(maximum[1] - minimum[1], minimum_vertical)
        y = (
            vertical_center - vertical_span / 2 - below_padding,
            vertical_center + vertical_span / 2 + above_padding,
        )
        z = symmetric_axis(2, minimum_horizontal, horizontal_padding)
        bounds_minimum = [x[0], y[0], z[0]]
        bounds_maximum = [x[1], y[1], z[1]]
    else:
        bounds_minimum = list(policy.get("boundsMinimum", []))
        bounds_maximum = list(policy.get("boundsMaximum", []))
        if len(bounds_minimum) != 3 or len(bounds_maximum) != 3:
            raise RuntimeError("Explicit finite fog box bounds are invalid")

    containment = all(
        bounds_minimum[axis] <= minimum[axis] + 1e-9
        and bounds_maximum[axis] >= maximum[axis] - 1e-9
        for axis in range(3)
    )
    if not containment:
        raise RuntimeError(
            "Finite fog domain does not contain every visible evaluated mesh/camera frame"
        )
    size = [bounds_maximum[axis] - bounds_minimum[axis] for axis in range(3)]
    maximum_extent = policy.get("maximumExtentMeters")
    if (
        not isinstance(maximum_extent, (int, float))
        or not math.isfinite(maximum_extent)
        or maximum_extent <= 0
        or any(extent <= 0 or extent > maximum_extent for extent in size)
    ):
        raise RuntimeError("Finite fog domain exceeds maximumExtentMeters")
    renderer_derivation = {
        "policy": policy,
        "sampledFrames": sampled_frames,
        "includedVisibleObjects": [obj.name for obj in visible_meshes],
        "evaluatedSourceBoundsMinimum": minimum,
        "evaluatedSourceBoundsMaximum": maximum,
        "boundsMinimum": bounds_minimum,
        "boundsMaximum": bounds_maximum,
    }
    renderer_hash = hashlib.sha256(
        json.dumps(renderer_derivation, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return {
        **renderer_derivation,
        "boundsMinimum": bounds_minimum,
        "boundsMaximum": bounds_maximum,
        "size": size,
        "evaluatedPointCount": evaluated_point_count,
        "allVisibleObjectsContained": True,
        "allSampledFramesContained": True,
        "cameraAndTargetContained": True,
        "rendererDerivationSha256": renderer_hash,
    }


def validate_finite_fog_domain(domain):
    if not isinstance(domain, dict):
        raise RuntimeError("Finite fog requires a resolved scene-envelope domain")
    if domain.get("schemaVersion") != 1 or domain.get("policy") not in (
        "scene-envelope-v1",
        "explicit-box-v1",
    ):
        raise RuntimeError("Unsupported finite fog domain policy")
    if domain.get("coordinateSystem") != "videoer-y-up-meters":
        raise RuntimeError("Finite fog domain must use Videoer's Y-up metre coordinates")

    def vector(name):
        value = domain.get(name)
        if (
            not isinstance(value, list)
            or len(value) != 3
            or not all(isinstance(component, (int, float)) and math.isfinite(component) for component in value)
        ):
            raise RuntimeError(f"Finite fog domain {name} is invalid")
        return value

    bounds_minimum = vector("boundsMinimum")
    bounds_maximum = vector("boundsMaximum")
    center = vector("center")
    size = vector("size")
    for axis in range(3):
        expected_size = bounds_maximum[axis] - bounds_minimum[axis]
        expected_center = (bounds_maximum[axis] + bounds_minimum[axis]) / 2
        if expected_size <= 0 or abs(size[axis] - expected_size) > 1e-8:
            raise RuntimeError("Finite fog domain size does not match its bounds")
        if abs(center[axis] - expected_center) > 1e-8:
            raise RuntimeError("Finite fog domain center does not match its bounds")
    edge_falloff = domain.get("edgeFalloffMeters")
    if (
        not isinstance(edge_falloff, (int, float))
        or not math.isfinite(edge_falloff)
        or edge_falloff <= 0
        or edge_falloff >= min(size) / 2
    ):
        raise RuntimeError("Finite fog domain edge falloff is invalid for its bounds")
    derivation_hash = domain.get("derivationSha256")
    if (
        not isinstance(derivation_hash, str)
        or len(derivation_hash) != 64
        or any(character not in "0123456789abcdef" for character in derivation_hash)
    ):
        raise RuntimeError("Finite fog domain derivation hash is invalid")
    maximum_extent = domain.get("maximumExtentMeters")
    if (
        not isinstance(maximum_extent, (int, float))
        or not math.isfinite(maximum_extent)
        or maximum_extent <= 0
        or any(extent > maximum_extent for extent in size)
    ):
        raise RuntimeError("Finite fog domain exceeds maximumExtentMeters")
    return edge_falloff, derivation_hash


def create_fog(scene, density, color=(0.16, 0.2, 0.28), domain=None):
    world = scene.world
    if world is None or not world.use_nodes:
        raise RuntimeError("Cinematic fog requires the explicit Videoer world-node surface")
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    output = nodes.get(WORLD_OUTPUT_NODE)
    background = nodes.get(WORLD_BACKGROUND_NODE)
    if (
        output is None
        or output.type != "OUTPUT_WORLD"
        or background is None
        or background.type != "BACKGROUND"
        or not any(
            link.from_node == background
            and link.to_node == output
            and link.to_socket == output.inputs["Surface"]
            for link in links
        )
    ):
        raise RuntimeError("Cinematic fog found an invalid or replaced Videoer world surface")
    for link in list(output.inputs["Volume"].links):
        links.remove(link)
    existing_world_volume = nodes.get(WORLD_VOLUME_NODE)
    if existing_world_volume is not None:
        nodes.remove(existing_world_volume)
    existing_object = bpy.data.objects.get(FOG_OBJECT_NAME)
    if existing_object is not None:
        bpy.data.objects.remove(existing_object, do_unlink=True)
    existing_material = bpy.data.materials.get(FOG_MATERIAL_NAME)
    if existing_material is not None:
        bpy.data.materials.remove(existing_material)
    if density <= 0:
        return {
            "enabled": False,
            "density": density,
            "surfacePreserved": True,
            "worldVolumeLinked": False,
        }
    edge_falloff, derivation_hash = validate_finite_fog_domain(domain)
    evaluated_domain = evaluated_fog_domain(scene, domain)
    bounds_minimum = evaluated_domain["boundsMinimum"]
    bounds_maximum = evaluated_domain["boundsMaximum"]
    blender_minimum, blender_maximum = canonical_bounds_to_blender(bounds_minimum, bounds_maximum)
    blender_size = [blender_maximum[axis] - blender_minimum[axis] for axis in range(3)]
    blender_center = [
        (blender_maximum[axis] + blender_minimum[axis]) / 2 for axis in range(3)
    ]
    bpy.ops.mesh.primitive_cube_add(size=1, location=blender_center)
    fog_object = bpy.context.object
    fog_object.name = FOG_OBJECT_NAME
    fog_object.scale = [extent for extent in blender_size]
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    fog_object.display_type = "WIRE"

    material = bpy.data.materials.new(FOG_MATERIAL_NAME)
    material.use_nodes = True
    material.node_tree.nodes.clear()
    material_nodes = material.node_tree.nodes
    material_links = material.node_tree.links
    material_output = material_nodes.new("ShaderNodeOutputMaterial")
    material_output.name = "videoer-fog-material-output"
    volume = material_nodes.new("ShaderNodeVolumePrincipled")
    volume.name = "videoer-fog-principled-volume"
    volume.inputs["Color"].default_value = (*color, 1)
    coordinates = material_nodes.new("ShaderNodeTexCoord")
    coordinates.name = "videoer-fog-generated-coordinates"
    separate = material_nodes.new("ShaderNodeSeparateXYZ")
    separate.name = "videoer-fog-separate-coordinates"
    material_links.new(coordinates.outputs["Generated"], separate.inputs["Vector"])
    axis_distances = []
    for axis, socket_name in enumerate(("X", "Y", "Z")):
        complement = material_nodes.new("ShaderNodeMath")
        complement.operation = "SUBTRACT"
        complement.inputs[0].default_value = 1
        material_links.new(separate.outputs[socket_name], complement.inputs[1])
        nearest_edge = material_nodes.new("ShaderNodeMath")
        nearest_edge.operation = "MINIMUM"
        material_links.new(separate.outputs[socket_name], nearest_edge.inputs[0])
        material_links.new(complement.outputs[0], nearest_edge.inputs[1])
        metres = material_nodes.new("ShaderNodeMath")
        metres.operation = "MULTIPLY"
        metres.inputs[1].default_value = blender_size[axis]
        material_links.new(nearest_edge.outputs[0], metres.inputs[0])
        axis_distances.append(metres.outputs[0])
    minimum_xy = material_nodes.new("ShaderNodeMath")
    minimum_xy.operation = "MINIMUM"
    material_links.new(axis_distances[0], minimum_xy.inputs[0])
    material_links.new(axis_distances[1], minimum_xy.inputs[1])
    minimum_xyz = material_nodes.new("ShaderNodeMath")
    minimum_xyz.operation = "MINIMUM"
    material_links.new(minimum_xy.outputs[0], minimum_xyz.inputs[0])
    material_links.new(axis_distances[2], minimum_xyz.inputs[1])
    taper = material_nodes.new("ShaderNodeMapRange")
    taper.name = "videoer-fog-smootherstep-taper"
    taper.data_type = "FLOAT"
    taper.interpolation_type = "SMOOTHERSTEP"
    taper.clamp = True
    taper.inputs["From Min"].default_value = 0
    taper.inputs["From Max"].default_value = edge_falloff
    taper.inputs["To Min"].default_value = 0
    taper.inputs["To Max"].default_value = 1
    material_links.new(minimum_xyz.outputs[0], taper.inputs["Value"])
    density_scale = material_nodes.new("ShaderNodeMath")
    density_scale.name = "videoer-fog-density-scale"
    density_scale.operation = "MULTIPLY"
    density_scale.inputs[1].default_value = density
    material_links.new(taper.outputs["Result"], density_scale.inputs[0])
    material_links.new(density_scale.outputs[0], volume.inputs["Density"])
    material_links.new(volume.outputs["Volume"], material_output.inputs["Volume"])
    fog_object.data.materials.append(material)
    return {
        "enabled": True,
        "implementation": "finite-mesh-volume-v1",
        "density": density,
        "color": list(color),
        "surfacePreserved": True,
        "worldVolumeLinked": output.inputs["Volume"].is_linked,
        "materialVolumeLinked": material_output.inputs["Volume"].is_linked,
        "objectName": fog_object.name,
        "materialName": material.name,
        "coordinateSystem": "videoer-y-up-meters",
        "boundsMinimum": bounds_minimum,
        "boundsMaximum": bounds_maximum,
        "blenderBoundsMinimum": blender_minimum,
        "blenderBoundsMaximum": blender_maximum,
        "blenderSizeMeters": blender_size,
        "edgeFalloffMeters": edge_falloff,
        "edgeFalloffImplementation": "minimum-distance-smootherstep-v1",
        "derivationSha256": derivation_hash,
        "requestedPolicy": domain["requestedPolicy"],
        "evaluatedBounds": evaluated_domain,
    }


def create_translucent_vfx_material(name, color, opacity, roughness, emission_strength=0.0):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*color, opacity)
    material.roughness = roughness
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    principled = nodes.get("Principled BSDF")
    output = nodes.get("Material Output")
    principled.inputs["Base Color"].default_value = (*color, 1)
    principled.inputs["Roughness"].default_value = roughness
    principled.inputs["Alpha"].default_value = 1.0
    emission = principled.inputs.get("Emission Color") or principled.inputs.get("Emission")
    if emission:
        emission.default_value = (*color, 1)
    if principled.inputs.get("Emission Strength"):
        principled.inputs["Emission Strength"].default_value = emission_strength
    for link in list(links):
        if link.to_node == output and link.to_socket == output.inputs["Surface"]:
            links.remove(link)
    transparent = nodes.new("ShaderNodeBsdfTransparent")
    mix = nodes.new("ShaderNodeMixShader")
    mix.inputs[0].default_value = opacity
    links.new(transparent.outputs[0], mix.inputs[1])
    links.new(principled.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], output.inputs["Surface"])
    if hasattr(material, "surface_render_method"):
        material.surface_render_method = "DITHERED"
    return material


def create_camera_relative_rain(layer, camera, fps, wind):
    generator = random.Random(layer["seed"])
    curve_data = bpy.data.curves.new(f"cinematic-rain-{layer['id']}", type="CURVE")
    curve_data.dimensions = "3D"
    curve_data.bevel_depth = layer["streakRadiusMeters"]
    curve_data.bevel_resolution = 0
    half_width = layer["horizontalSpanMeters"] / 2
    half_height = layer["verticalSpanMeters"] / 2
    for _ in range(layer["count"]):
        x = generator.uniform(-half_width, half_width)
        y = generator.uniform(-half_height, half_height)
        depth = generator.uniform(layer["depthMinimumMeters"], layer["depthMaximumMeters"])
        length = layer["streakLengthMeters"] * generator.uniform(
            1.0 - layer.get("lengthVariation", 0.0),
            1.0 + layer.get("lengthVariation", 0.0),
        )
        speed = layer["fallSpeedMetersPerSecond"] * generator.uniform(
            1.0 - layer.get("speedVariation", 0.0),
            1.0 + layer.get("speedVariation", 0.0),
        )
        travel_seconds = length / speed
        spline = curve_data.splines.new("POLY")
        spline.points.add(1)
        spline.points[0].co = (x, y, -depth, 1)
        spline.points[1].co = (
            x + wind[0] * travel_seconds,
            y - length,
            -depth + wind[1] * travel_seconds,
            1,
        )
    rain = bpy.data.objects.new(f"cinematic-rain-{layer['id']}", curve_data)
    bpy.context.collection.objects.link(rain)
    rain.parent = camera
    rain.location = (0, 0, 0)
    material = create_translucent_vfx_material(
        f"cinematic-rain-{layer['id']}-material",
        layer["color"],
        layer["opacity"],
        0.12,
        0.18,
    )
    curve_data.materials.append(material)
    distance = layer["verticalSpanMeters"] + layer["streakLengthMeters"]
    cycle_seconds = distance / layer["fallSpeedMetersPerSecond"]
    rain.keyframe_insert(data_path="location", frame=1)
    rain.location.y = -distance
    rain.keyframe_insert(data_path="location", frame=max(2, round(cycle_seconds * fps) + 1))
    action = rain.animation_data.action
    for curve in action.fcurves:
        for point in curve.keyframe_points:
            point.interpolation = "LINEAR"
        curve.modifiers.new(type="CYCLES")


def transform_canonical_point(point, transform):
    x = point[0] * transform["scale"][0]
    y = point[1] * transform["scale"][1]
    z = point[2] * transform["scale"][2]
    rx, ry, rz = transform["rotation"]
    y, z = y * math.cos(rx) - z * math.sin(rx), y * math.sin(rx) + z * math.cos(rx)
    x, z = x * math.cos(ry) + z * math.sin(ry), -x * math.sin(ry) + z * math.cos(ry)
    x, y = x * math.cos(rz) - y * math.sin(rz), x * math.sin(rz) + y * math.cos(rz)
    return (
        x + transform["position"][0],
        y + transform["position"][1],
        z + transform["position"][2],
    )


def create_surface_water_optical_surface(definition, field_report):
    """Create the conserved optical top surface; the receiver wet-film remains separate."""
    surface = load_json(definition["surfaceWaterOpticalSurfacePath"])
    entity_id = definition["id"]
    schema_version = surface.get("schemaVersion")
    if schema_version not in (1, 2):
        raise RuntimeError(f"Entity '{entity_id}' optical water surface schema is unsupported")
    expected_generator = f"videoer.surface-water-optical-surface.v{schema_version}"
    if surface.get("generator") != expected_generator:
        raise RuntimeError(
            f"Entity '{entity_id}' optical water surface has an unsupported generator"
        )
    if surface.get("sourceFieldId") != field_report["fieldId"]:
        raise RuntimeError(
            f"Entity '{entity_id}' optical water surface source field identity does not match"
        )
    if surface.get("sourceFieldSha256") != field_report["fieldSha256"]:
        raise RuntimeError(
            f"Entity '{entity_id}' optical water surface source field hash does not match"
        )

    positions = surface.get("positions")
    ground_heights = surface.get("groundHeightsMeters")
    depths = surface.get("depthsMeters")
    indices = surface.get("indices")
    report = surface.get("report")
    options = surface.get("options")
    if not all(isinstance(value, list) for value in (positions, ground_heights, depths, indices)):
        raise RuntimeError(f"Entity '{entity_id}' optical water surface arrays are missing")
    if not isinstance(report, dict) or not isinstance(options, dict):
        raise RuntimeError(f"Entity '{entity_id}' optical water surface metadata is missing")
    if len(positions) != len(ground_heights) or len(positions) != len(depths):
        raise RuntimeError(
            f"Entity '{entity_id}' optical water surface vertex attribute lengths differ"
        )
    if len(indices) % 3 != 0:
        raise RuntimeError(
            f"Entity '{entity_id}' optical water surface indices do not describe triangles"
        )
    if report.get("vertexCount") != len(positions) or report.get("triangleCount") != len(indices) // 3:
        raise RuntimeError(f"Entity '{entity_id}' optical water surface counts do not match its report")
    reconstruction_hash = surface.get("reconstructionSha256")
    if (
        not isinstance(reconstruction_hash, str)
        or len(reconstruction_hash) != 64
        or any(character not in "0123456789abcdef" for character in reconstruction_hash)
    ):
        raise RuntimeError(f"Entity '{entity_id}' optical water surface lacks a reconstruction hash")
    optical_offset = options.get("opticalOffsetMeters")
    if not isinstance(optical_offset, (int, float)) or not math.isfinite(optical_offset):
        raise RuntimeError(f"Entity '{entity_id}' optical water surface offset is invalid")

    if schema_version == 2:
        appearance = surface.get("appearance")
        if not isinstance(appearance, dict) or appearance.get("model") != "thin-dielectric-water-v1":
            raise RuntimeError(f"Entity '{entity_id}' optical water appearance is unsupported")
        ior = appearance.get("ior")
        roughness = appearance.get("roughness")
        absorption_color = appearance.get("absorptionColorLinear")
        absorption_distance = appearance.get("absorptionDistanceMeters")
        if (
            not isinstance(ior, (int, float))
            or not math.isfinite(ior)
            or ior < 1.3
            or ior > 1.36
            or not isinstance(roughness, (int, float))
            or not math.isfinite(roughness)
            or roughness < 0.005
            or roughness > 0.2
            or not isinstance(absorption_color, list)
            or len(absorption_color) != 3
            or not all(
                isinstance(value, (int, float)) and math.isfinite(value) and 0 <= value <= 1
                for value in absorption_color
            )
            or not isinstance(absorption_distance, (int, float))
            or not math.isfinite(absorption_distance)
            or absorption_distance < 0.05
            or absorption_distance > 100
        ):
            raise RuntimeError(f"Entity '{entity_id}' optical water appearance is invalid")
    else:
        # Schema v1 predated a renderer-independent appearance declaration. Preserve its
        # established clean-water constants for compatibility, but identify the legacy
        # adaptation explicitly in the report below.
        ior = 1.333
        roughness = 0.045
        absorption_color = [1.0, 1.0, 1.0]
        absorption_distance = 1.0

    vertices = []
    for vertex_index, (position, ground_height, depth) in enumerate(
        zip(positions, ground_heights, depths)
    ):
        if (
            not isinstance(position, list)
            or len(position) != 3
            or not all(isinstance(value, (int, float)) and math.isfinite(value) for value in position)
            or not isinstance(ground_height, (int, float))
            or not math.isfinite(ground_height)
            or not isinstance(depth, (int, float))
            or not math.isfinite(depth)
            or depth < 0
        ):
            raise RuntimeError(
                f"Entity '{entity_id}' optical water vertex {vertex_index} is invalid"
            )
        expected_y = ground_height + optical_offset + depth
        if abs(position[1] - expected_y) > 1e-9:
            raise RuntimeError(
                f"Entity '{entity_id}' optical water vertex {vertex_index} violates depth semantics"
            )
        vertices.append(geometry_probe.to_blender(position))

    faces = []
    reconstructed_volume = 0.0
    projected_area = 0.0
    for offset in range(0, len(indices), 3):
        triangle = indices[offset : offset + 3]
        if any(not isinstance(index, int) or index < 0 or index >= len(positions) for index in triangle):
            raise RuntimeError(
                f"Entity '{entity_id}' optical water triangle {offset // 3} has an invalid index"
            )
        if len(set(triangle)) != 3:
            raise RuntimeError(
                f"Entity '{entity_id}' optical water triangle {offset // 3} repeats a vertex"
            )
        a, b, c = [positions[index] for index in triangle]
        signed_twice_area = (
            (b[0] - a[0]) * (c[2] - a[2])
            - (b[2] - a[2]) * (c[0] - a[0])
        )
        area = abs(signed_twice_area) * 0.5
        if area <= 1e-12:
            raise RuntimeError(
                f"Entity '{entity_id}' optical water triangle {offset // 3} is degenerate"
            )
        # Videoer is Y-up. A negative signed XZ area maps to Blender's upward +Z normal.
        if signed_twice_area >= 0:
            raise RuntimeError(
                f"Entity '{entity_id}' optical water triangle {offset // 3} is not upward-facing"
            )
        projected_area += area
        reconstructed_volume += area * sum(depths[index] for index in triangle) / 3
        faces.append(tuple(triangle))

    declared_volume = report.get("reconstructedVolumeCubicMeters")
    source_volume = report.get("sourcePuddleVolumeCubicMeters")
    if not all(
        isinstance(value, (int, float)) and math.isfinite(value) and value >= 0
        for value in (declared_volume, source_volume)
    ):
        raise RuntimeError(f"Entity '{entity_id}' optical water volume report is invalid")
    volume_tolerance = max(1e-12, source_volume * 1e-9)
    if (
        abs(reconstructed_volume - declared_volume) > volume_tolerance
        or abs(reconstructed_volume - source_volume) > volume_tolerance
    ):
        raise RuntimeError(f"Entity '{entity_id}' optical water surface does not conserve volume")

    mesh_data = bpy.data.meshes.new(f"{entity_id}-optical-water-surface")
    mesh_data.from_pydata(vertices, [], faces)
    mesh_data.update(calc_edges=True)
    depth_attribute = mesh_data.attributes.new(
        name="videoer_water_depth_meters", type="FLOAT", domain="POINT"
    )
    transmittance_attribute = mesh_data.attributes.new(
        name="videoer_water_transmittance_linear", type="FLOAT_COLOR", domain="POINT"
    )
    for vertex_index, depth in enumerate(depths):
        depth_attribute.data[vertex_index].value = depth
        # The declared absorption colour is transmittance over the declared distance.
        # Applying Beer-Lambert per vertex keeps the receiver view nearly colourless for
        # millimetre puddles and avoids an arbitrary dark shader base.
        transmittance = [
            max(0.0, min(1.0, channel ** (depth / absorption_distance)))
            for channel in absorption_color
        ]
        transmittance_attribute.data[vertex_index].color = (*transmittance, 1.0)
    water = bpy.data.objects.new(f"{entity_id}-optical-water-surface", mesh_data)
    bpy.context.collection.objects.link(water)
    for polygon in mesh_data.polygons:
        polygon.use_smooth = True

    material = bpy.data.materials.new(f"{entity_id}-optical-water")
    material.diffuse_color = (1.0, 1.0, 1.0, 0.08)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    output.name = "videoer-water-output"
    output.label = "Thin dielectric output"
    transparent = nodes.new("ShaderNodeBsdfTransparent")
    transparent.name = "videoer-water-receiver-view"
    transparent.label = "Depth-attenuated receiver view"
    transmittance = nodes.new("ShaderNodeAttribute")
    transmittance.name = "videoer-water-transmittance"
    transmittance.label = "Declared Beer-Lambert transmittance"
    transmittance.attribute_name = "videoer_water_transmittance_linear"
    reflection = nodes.new("ShaderNodeBsdfAnisotropic")
    reflection.name = "videoer-water-fresnel-reflection"
    reflection.label = "Neutral dielectric reflection"
    reflection.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    reflection.inputs["Roughness"].default_value = roughness
    if reflection.inputs.get("Anisotropy"):
        reflection.inputs["Anisotropy"].default_value = 0.0
    fresnel = nodes.new("ShaderNodeFresnel")
    fresnel.name = "videoer-water-fresnel"
    fresnel.label = "Declared water IOR"
    fresnel.inputs["IOR"].default_value = ior
    mix = nodes.new("ShaderNodeMixShader")
    mix.name = "videoer-water-interface"
    mix.label = "Transparent receiver plus Fresnel reflection"
    links.new(transmittance.outputs["Color"], transparent.inputs["Color"])
    links.new(fresnel.outputs["Fac"], mix.inputs[0])
    links.new(transparent.outputs[0], mix.inputs[1])
    links.new(reflection.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], output.inputs["Surface"])
    cycles = bpy.context.scene.render.engine == "CYCLES"
    if not cycles and hasattr(material, "surface_render_method"):
        # Eevee cannot trace the receiver through a dielectric volume. Its explicit
        # approximation uses the same thin Fresnel interface with dithered transparency.
        material.surface_render_method = "DITHERED"
    mesh_data.materials.append(material)
    water.hide_render = not definition.get("visible", True)
    return {
        "id": surface.get("id"),
        "reconstructionSha256": surface["reconstructionSha256"],
        "objectName": water.name,
        "vertexCount": len(vertices),
        "triangleCount": len(faces),
        "projectedAreaSquareMeters": projected_area,
        "reconstructedVolumeCubicMeters": reconstructed_volume,
        "sourcePuddleVolumeCubicMeters": source_volume,
        "materialModel": (
            "thin-dielectric-interface-cycles-v2"
            if cycles
            else "thin-fresnel-transparent-eevee-approximation-v2"
        ),
        "appearanceSource": "surface-v2" if schema_version == 2 else "legacy-v1-adaptation",
        "ior": ior,
        "roughness": roughness,
        "depthAttribute": "videoer_water_depth_meters",
        "transmittanceAttribute": "videoer_water_transmittance_linear",
        "separateContinuousReceiverFilmPreserved": True,
    }


def create_surface_water(definition, receiver_asset, receiver_mesh):
    field = load_json(definition["surfaceWaterFieldPath"])
    if field.get("generator") not in (
        "videoer.static-surface-water.v1",
        "videoer.static-surface-water.v2",
    ):
        raise RuntimeError(
            f"Entity '{definition['id']}' surface-water field has an unsupported generator"
        )
    if field.get("receiver", {}).get("geometryId") != receiver_asset.get("id"):
        raise RuntimeError(
            f"Entity '{definition['id']}' surface-water receiver identity does not match its geometry"
        )
    if field.get("receiver", {}).get("transform") != definition.get("transform"):
        raise RuntimeError(
            f"Entity '{definition['id']}' surface-water receiver transform does not match the entity"
        )
    mass = field.get("massBalance", {})
    if abs(mass.get("errorCubicMeters", 1)) > max(
        1e-12, mass.get("incidentCubicMeters", 0) * 1e-10
    ):
        raise RuntimeError(f"Entity '{definition['id']}' surface-water field fails mass balance")

    maximum_free_depth = max(
        1e-8,
        *[
            cell["filmDepthMeters"]
            + cell["edgeAccumulationDepthMeters"]
            + cell["puddleDepthMeters"]
            for cell in field["cells"]
        ],
    )
    columns = field["grid"]["columns"]
    rows = field["grid"]["rows"]
    cell_size = field["grid"]["cellSizeMeters"]
    pixels = [0.0] * (columns * rows * 4)
    wet_cell_count = 0
    for cell in field["cells"]:
        free_depth = (
            cell["filmDepthMeters"]
            + cell["edgeAccumulationDepthMeters"]
            + cell["puddleDepthMeters"]
        )
        absorbed = cell["absorbedDepthMeters"]
        strength = min(
            1.0,
            (0.28 if absorbed > 1e-9 else 0.0)
            + (0.72 * math.sqrt(free_depth / maximum_free_depth) if free_depth > 0 else 0.0),
        )
        pixel = cell["index"] * 4
        pixels[pixel : pixel + 4] = [
            strength * cell["coverage"],
            min(1.0, cell["puddleDepthMeters"] / maximum_free_depth),
            cell["effectiveRoughness"],
            cell["exposure"],
        ]
        if strength > 0:
            wet_cell_count += 1

    image = bpy.data.images.new(
        f"{definition['id']}-surface-water-field",
        width=columns,
        height=rows,
        alpha=True,
        float_buffer=True,
    )
    image.colorspace_settings.name = "Non-Color"
    image.pixels.foreach_set(pixels)
    image.pack()
    uv_layer = receiver_mesh.data.uv_layers.get("surface_water_uv")
    if uv_layer is None:
        uv_layer = receiver_mesh.data.uv_layers.new(name="surface_water_uv")
    origin_x, origin_z = field["grid"]["worldOriginXZ"]
    extent_x = columns * cell_size
    extent_z = rows * cell_size
    for loop in receiver_mesh.data.loops:
        point = transform_canonical_point(
            receiver_asset["positions"][loop.vertex_index], definition["transform"]
        )
        uv_layer.data[loop.index].uv = (
            (point[0] - origin_x) / extent_x,
            (point[2] - origin_z) / extent_z,
        )

    for slot_index, original in enumerate(list(receiver_mesh.data.materials)):
        material = original.copy()
        material.name = f"{original.name}-receiver-water"
        receiver_mesh.data.materials[slot_index] = material
        material.use_nodes = True
        nodes = material.node_tree.nodes
        links = material.node_tree.links
        principled = nodes.get("Principled BSDF")
        if principled is None:
            raise RuntimeError(
                f"Entity '{definition['id']}' material '{material.name}' lacks Principled BSDF"
            )
        uv = nodes.new("ShaderNodeUVMap")
        uv.uv_map = "surface_water_uv"
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = image
        texture.interpolation = "Linear"
        texture.extension = "EXTEND"
        separate = nodes.new("ShaderNodeSeparateColor")
        links.new(uv.outputs["UV"], texture.inputs["Vector"])
        links.new(texture.outputs["Color"], separate.inputs["Color"])

        base = principled.inputs["Base Color"]
        base_source = base.links[0].from_socket if base.is_linked else None
        base_default = tuple(base.default_value)
        if base.is_linked:
            links.remove(base.links[0])
        darken = nodes.new("ShaderNodeMixRGB")
        darken.blend_type = "MULTIPLY"
        darken.inputs[2].default_value = (0.66, 0.7, 0.76, 1)
        links.new(separate.outputs["Red"], darken.inputs[0])
        if base_source:
            links.new(base_source, darken.inputs[1])
        else:
            darken.inputs[1].default_value = base_default
        links.new(darken.outputs[0], base)

        roughness = principled.inputs["Roughness"]
        roughness_source = roughness.links[0].from_socket if roughness.is_linked else None
        roughness_default = roughness.default_value
        if roughness.is_linked:
            links.remove(roughness.links[0])
        dry_weight = nodes.new("ShaderNodeMath")
        dry_weight.operation = "SUBTRACT"
        dry_weight.inputs[0].default_value = 1
        links.new(separate.outputs["Red"], dry_weight.inputs[1])
        dry_roughness = nodes.new("ShaderNodeMath")
        dry_roughness.operation = "MULTIPLY"
        if roughness_source:
            links.new(roughness_source, dry_roughness.inputs[0])
        else:
            dry_roughness.inputs[0].default_value = roughness_default
        links.new(dry_weight.outputs[0], dry_roughness.inputs[1])
        wet_roughness = nodes.new("ShaderNodeMath")
        wet_roughness.operation = "MULTIPLY"
        links.new(separate.outputs["Blue"], wet_roughness.inputs[0])
        links.new(separate.outputs["Red"], wet_roughness.inputs[1])
        combined_roughness = nodes.new("ShaderNodeMath")
        combined_roughness.operation = "ADD"
        links.new(dry_roughness.outputs[0], combined_roughness.inputs[0])
        links.new(wet_roughness.outputs[0], combined_roughness.inputs[1])
        links.new(combined_roughness.outputs[0], roughness)
        coat = principled.inputs.get("Coat Weight")
        if coat and not coat.is_linked:
            coat_scale = nodes.new("ShaderNodeMath")
            coat_scale.operation = "MULTIPLY"
            coat_scale.inputs[1].default_value = 0.72
            links.new(separate.outputs["Red"], coat_scale.inputs[0])
            links.new(coat_scale.outputs[0], coat)
        coat_roughness = principled.inputs.get("Coat Roughness")
        if coat_roughness and not coat_roughness.is_linked:
            coat_roughness.default_value = 0.055
    return {
        "entityId": definition["id"],
        "fieldId": field["id"],
        "fieldSha256": field["fieldSha256"],
        "activeCellCount": field["grid"]["activeCellCount"],
        "renderedWetCellCount": wet_cell_count,
        "splashEligibleCells": [cell for cell in field["cells"] if cell["splashEligible"]],
        "cellSizeMeters": cell_size,
        "massBalance": mass,
    }


def create_surface_history(definition, receiver_asset, receiver_mesh):
    field = load_json(definition["surfaceHistoryFieldPath"])
    water = load_json(definition["surfaceWaterFieldPath"])
    preflight = definition.get("surfaceHistoryVerification")
    if not isinstance(preflight, dict) or preflight.get("verifier") != "videoer.surface-history-render-preflight.v1":
        raise RuntimeError(
            f"Entity '{definition['id']}' surface-history field lacks a verified render preflight"
        )
    for path_key, expected_key in (
        ("surfaceHistoryFieldPath", "fieldFileSha256"),
        ("surfaceWaterFieldPath", "waterFileSha256"),
    ):
        with open(definition[path_key], "rb") as handle:
            actual = hashlib.sha256(handle.read()).hexdigest()
        if actual != preflight.get(expected_key):
            raise RuntimeError(
                f"Entity '{definition['id']}' surface-history render-preflight file hash is stale"
            )
    if (
        field.get("fieldSha256") != preflight.get("fieldSha256")
        or water.get("fieldSha256") != preflight.get("waterFieldSha256")
    ):
        raise RuntimeError(
            f"Entity '{definition['id']}' surface-history render-preflight semantic identity is stale"
        )
    schema_version = field.get("schemaVersion")
    if field.get("generator") != f"videoer.construction-surface-history.v{schema_version}" or schema_version not in (1, 2, 3):
        raise RuntimeError(
            f"Entity '{definition['id']}' surface-history field has an unsupported generator"
        )
    if field.get("sourceWaterField", {}).get("id") != water.get("id") or field.get(
        "sourceWaterField", {}
    ).get("fieldSha256") != water.get("fieldSha256"):
        raise RuntimeError(
            f"Entity '{definition['id']}' surface-history field does not bind its exact source water"
        )
    if schema_version in (2, 3):
        if water.get("generator") != "videoer.static-surface-water.v2":
            raise RuntimeError(
                f"Entity '{definition['id']}' surface-history v{schema_version} requires surface-water v2"
            )
        if field.get("sourceWaterField", {}).get("routingSha256") != water.get(
            "routing", {}
        ).get("routingSha256"):
            raise RuntimeError(
                f"Entity '{definition['id']}' surface-history routing identity is stale"
            )
        if water.get("routing", {}).get("routingSha256") != preflight.get("routingSha256"):
            raise RuntimeError(
                f"Entity '{definition['id']}' surface-history render-preflight routing identity is stale"
            )
    if field.get("receiver", {}).get("geometryId") != receiver_asset.get("id"):
        raise RuntimeError(
            f"Entity '{definition['id']}' surface-history receiver identity does not match geometry"
        )
    if field.get("receiver", {}).get("transform") != definition.get("transform"):
        raise RuntimeError(
            f"Entity '{definition['id']}' surface-history receiver transform does not match entity"
        )
    if field.get("grid") != water.get("grid") or len(field.get("cells", [])) != len(
        water.get("cells", [])
    ):
        raise RuntimeError(
            f"Entity '{definition['id']}' surface-history topology does not match source water"
        )
    dirt_totals = {
        "inputKilograms": 0.0,
        "persistentKilograms": 0.0,
        "looseKilograms": 0.0,
        "mobilizedKilograms": 0.0,
        "depositedKilograms": 0.0,
    }
    dirt_by_index = {}
    for history_cell, water_cell in zip(field["cells"], water["cells"]):
        identity = (
            "index",
            "row",
            "column",
            "worldPosition",
            "triangleIndex",
            "materialId",
            "targetClass",
            "coverage",
        )
        if any(history_cell.get(key) != water_cell.get(key) for key in identity):
            raise RuntimeError(
                f"Entity '{definition['id']}' surface-history cell topology is stale"
            )
        history_channels = (
            (
                "trafficWear",
                "rainExposureFraction",
                "shelterProtection",
                "exposureWeathering",
                "runoffThroughflowStaining",
                "retainedWaterStaining",
                "runoffStaining",
                "repairInfluence",
                "repairRelativeAge",
            )
            if schema_version == 3
            else (
                "trafficWear",
                "longTermExposure",
                "runoffStaining",
                "repairInfluence",
                "repairRelativeAge",
            )
        )
        for channel in history_channels:
            value = history_cell.get(channel)
            if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 or value > 1:
                raise RuntimeError(
                    f"Entity '{definition['id']}' surface-history channel '{channel}' is invalid"
                )
        if schema_version == 3:
            if abs(
                history_cell["rainExposureFraction"] - water_cell.get("exposure", -1)
            ) > 1e-12:
                raise RuntimeError(
                    f"Entity '{definition['id']}' surface-history v3 exposure source is stale"
                )
            if abs(
                history_cell["shelterProtection"]
                - (1 - history_cell["rainExposureFraction"])
            ) > 1e-12:
                raise RuntimeError(
                    f"Entity '{definition['id']}' surface-history v3 shelter complement is invalid"
                )
            combined_runoff = 1 - (
                1 - history_cell["runoffThroughflowStaining"]
            ) * (1 - history_cell["retainedWaterStaining"])
            if abs(history_cell["runoffStaining"] - combined_runoff) > 1e-12:
                raise RuntimeError(
                    f"Entity '{definition['id']}' surface-history v3 runoff composition is invalid"
                )
        if schema_version in (2, 3):
            dirt = history_cell.get("dirt", {})
            for channel in (
                "builtUpMassKilograms",
                "persistentMassKilograms",
                "initialLooseMassKilograms",
                "incomingSuspendedMassKilograms",
                "mobilizedMassKilograms",
                "depositedMassKilograms",
                "finalLooseMassKilograms",
                "suspendedOutflowMassKilograms",
            ):
                value = dirt.get(channel)
                if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                    raise RuntimeError(
                        f"Entity '{definition['id']}' surface-history dirt mass '{channel}' is invalid"
                    )
            for channel in ("looseCoverage", "persistentCoverage"):
                value = dirt.get(channel)
                if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 or value > 1:
                    raise RuntimeError(
                        f"Entity '{definition['id']}' surface-history dirt coverage '{channel}' is invalid"
                    )
            cell_tolerance = max(1e-12, dirt["builtUpMassKilograms"] * 1e-10)
            if abs(
                dirt["builtUpMassKilograms"]
                - dirt["persistentMassKilograms"]
                - dirt["initialLooseMassKilograms"]
            ) > cell_tolerance:
                raise RuntimeError(
                    f"Entity '{definition['id']}' surface-history dirt cell {history_cell['index']} violates buildup partition"
                )
            if dirt["mobilizedMassKilograms"] > dirt["initialLooseMassKilograms"] + cell_tolerance:
                raise RuntimeError(
                    f"Entity '{definition['id']}' surface-history dirt cell {history_cell['index']} mobilizes unavailable mass"
                )
            transport_error = (
                dirt["incomingSuspendedMassKilograms"]
                + dirt["mobilizedMassKilograms"]
                - dirt["depositedMassKilograms"]
                - dirt["suspendedOutflowMassKilograms"]
            )
            if abs(transport_error) > cell_tolerance:
                raise RuntimeError(
                    f"Entity '{definition['id']}' surface-history dirt cell {history_cell['index']} violates transport balance"
                )
            cell_error = (
                dirt["initialLooseMassKilograms"]
                + dirt["incomingSuspendedMassKilograms"]
                - dirt["finalLooseMassKilograms"]
                - dirt["suspendedOutflowMassKilograms"]
            )
            if abs(cell_error) > max(1e-12, dirt["initialLooseMassKilograms"] * 1e-10):
                raise RuntimeError(
                    f"Entity '{definition['id']}' surface-history dirt cell {history_cell['index']} violates mass balance"
                )
            dirt_totals["inputKilograms"] += dirt["builtUpMassKilograms"]
            dirt_totals["persistentKilograms"] += dirt["persistentMassKilograms"]
            dirt_totals["looseKilograms"] += dirt["finalLooseMassKilograms"]
            dirt_totals["mobilizedKilograms"] += dirt["mobilizedMassKilograms"]
            dirt_totals["depositedKilograms"] += dirt["depositedMassKilograms"]
            dirt_by_index[history_cell["index"]] = dirt

    if schema_version in (2, 3):
        mass = field.get("dirtMassBalance", {})
        for channel in (
            "inputKilograms",
            "persistentKilograms",
            "looseKilograms",
            "exportedKilograms",
            "mobilizedKilograms",
            "depositedKilograms",
            "errorKilograms",
        ):
            value = mass.get(channel)
            if not isinstance(value, (int, float)) or not math.isfinite(value):
                raise RuntimeError(
                    f"Entity '{definition['id']}' surface-history dirt total '{channel}' is invalid"
                )
        total_tolerance = max(1e-12, mass["inputKilograms"] * 1e-10)
        for channel, measured in dirt_totals.items():
            if abs(mass[channel] - measured) > total_tolerance:
                raise RuntimeError(
                    f"Entity '{definition['id']}' surface-history dirt total '{channel}' differs from its cells"
                )
        root_indices = {
            node["index"]
            for node in water.get("routing", {}).get("nodes", [])
            if node.get("downstreamIndex") is None
        }
        measured_export = sum(
            dirt_by_index[index]["suspendedOutflowMassKilograms"]
            for index in root_indices
        )
        if abs(mass["exportedKilograms"] - measured_export) > total_tolerance:
            raise RuntimeError(
                f"Entity '{definition['id']}' surface-history exported dirt differs from routing roots"
            )
        expected_incoming = {cell["index"]: 0.0 for cell in field["cells"]}
        for node in water["routing"]["nodes"]:
            downstream_index = node.get("downstreamIndex")
            if downstream_index is not None:
                expected_incoming[downstream_index] += dirt_by_index[node["index"]][
                    "suspendedOutflowMassKilograms"
                ]
        for index, expected in expected_incoming.items():
            incoming = dirt_by_index[index]["incomingSuspendedMassKilograms"]
            if abs(incoming - expected) > max(1e-12, max(incoming, expected) * 1e-10):
                raise RuntimeError(
                    f"Entity '{definition['id']}' surface-history dirt routing continuity is invalid at cell {index}"
                )
        dirt_error = mass.get("inputKilograms", 0) - (
            mass.get("persistentKilograms", 0)
            + mass.get("looseKilograms", 0)
            + mass.get("exportedKilograms", 0)
        )
        if abs(dirt_error) > max(1e-12, mass.get("inputKilograms", 0) * 1e-10):
            raise RuntimeError(
                f"Entity '{definition['id']}' surface-history dirt field violates mass balance"
            )
        if abs(dirt_error - mass["errorKilograms"]) > total_tolerance:
            raise RuntimeError(
                f"Entity '{definition['id']}' surface-history recorded dirt error is stale"
            )

    columns = field["grid"]["columns"]
    rows = field["grid"]["rows"]
    cell_size = field["grid"]["cellSizeMeters"]
    pixels = [0.0] * (columns * rows * 4)
    exposure_channel = "exposureWeathering" if schema_version == 3 else "longTermExposure"
    for cell in field["cells"]:
        pixel = cell["index"] * 4
        pixels[pixel : pixel + 4] = [
            cell["trafficWear"] * cell["coverage"],
            cell[exposure_channel] * cell["coverage"],
            cell["runoffStaining"] * cell["coverage"],
            cell["repairInfluence"] * cell["coverage"],
        ]
    image = bpy.data.images.new(
        f"{definition['id']}-surface-history-field",
        width=columns,
        height=rows,
        alpha=True,
        float_buffer=True,
    )
    image.colorspace_settings.name = "Non-Color"
    image.pixels.foreach_set(pixels)
    image.pack()
    dirt_image = None
    if schema_version in (2, 3):
        dirt_pixels = [0.0] * (columns * rows * 4)
        for cell in field["cells"]:
            pixel = cell["index"] * 4
            dirt_pixels[pixel : pixel + 4] = [
                cell["dirt"]["looseCoverage"] * cell["coverage"],
                cell["dirt"]["persistentCoverage"] * cell["coverage"],
                0.0,
                1.0,
            ]
        dirt_image = bpy.data.images.new(
            f"{definition['id']}-surface-dirt-mass-field",
            width=columns,
            height=rows,
            alpha=True,
            float_buffer=True,
        )
        dirt_image.colorspace_settings.name = "Non-Color"
        dirt_image.pixels.foreach_set(dirt_pixels)
        dirt_image.pack()
    uv_layer = receiver_mesh.data.uv_layers.get("surface_history_uv")
    if uv_layer is None:
        uv_layer = receiver_mesh.data.uv_layers.new(name="surface_history_uv")
    origin_x, origin_z = field["grid"]["worldOriginXZ"]
    extent_x = columns * cell_size
    extent_z = rows * cell_size
    for loop in receiver_mesh.data.loops:
        point = transform_canonical_point(
            receiver_asset["positions"][loop.vertex_index], definition["transform"]
        )
        uv_layer.data[loop.index].uv = (
            (point[0] - origin_x) / extent_x,
            (point[2] - origin_z) / extent_z,
        )

    definitions = receiver_asset.get("materials", [])
    active_material_ids = {cell["materialId"] for cell in field["cells"]}
    definitions_by_id = {item.get("id"): item for item in definitions}
    optical_materials = []
    transport_only_materials = []
    if schema_version == 3:
        for material_id in sorted(active_material_ids):
            material_definition = definitions_by_id.get(material_id)
            if material_definition is None:
                raise RuntimeError(
                    f"Entity '{definition['id']}' active v3 material '{material_id}' is absent from receiver geometry"
                )
            surface = material_definition.get("surface") or {}
            participation = surface.get("surfaceHistoryV3Participation")
            policy = (participation or {}).get("policy")
            has_causal = bool(surface.get("historyResponseV3"))
            has_dirt = bool(surface.get("dirtMassResponse"))
            if policy == "optical-response" and has_causal and has_dirt:
                optical_materials.append(material_id)
            elif (
                policy == "transport-only"
                and isinstance(participation.get("rationale"), str)
                and participation["rationale"].strip()
                and not has_causal
                and not has_dirt
            ):
                transport_only_materials.append(material_id)
            else:
                raise RuntimeError(
                    f"Entity '{definition['id']}' active v3 material '{material_id}' has invalid or incomplete surface-history participation"
                )
    response_materials = []
    dirt_response_materials = []
    unmapped_materials = []
    channel_outputs = ("Red", "Green", "Blue", "Alpha")
    response_contract = "historyResponseV3" if schema_version == 3 else "historyResponse"
    response_names = (
        ("trafficWear", "exposureWeathering", "runoffStaining", "repairInfluence")
        if schema_version == 3
        else ("trafficWear", "longTermExposure", "runoffStaining", "repairInfluence")
    )
    for slot_index, original in enumerate(list(receiver_mesh.data.materials)):
        material_definition = definitions[slot_index] if slot_index < len(definitions) else None
        material_id = (material_definition or {}).get("id")
        if schema_version == 3 and material_id not in active_material_ids:
            continue
        response = (material_definition or {}).get("surface", {}).get(response_contract)
        dirt_response = (material_definition or {}).get("surface", {}).get("dirtMassResponse")
        if schema_version == 3:
            participation = (material_definition or {}).get("surface", {}).get(
                "surfaceHistoryV3Participation", {}
            )
            if participation.get("policy") == "transport-only":
                continue
        if not response and not (dirt_image and dirt_response):
            if material_definition:
                unmapped_materials.append(material_definition["id"])
            continue
        material = original.copy()
        material.name = f"{original.name}-receiver-history"
        receiver_mesh.data.materials[slot_index] = material
        material.use_nodes = True
        nodes = material.node_tree.nodes
        links = material.node_tree.links
        principled = nodes.get("Principled BSDF")
        if principled is None:
            raise RuntimeError(
                f"Entity '{definition['id']}' history material '{material.name}' lacks Principled BSDF"
            )
        uv = nodes.new("ShaderNodeUVMap")
        uv.name = "videoer-surface-history-uv"
        uv.uv_map = "surface_history_uv"
        texture = nodes.new("ShaderNodeTexImage")
        texture.name = "videoer-surface-history-field"
        texture.image = image
        texture.interpolation = "Linear"
        texture.extension = "EXTEND"
        separate = nodes.new("ShaderNodeSeparateColor")
        separate.name = "videoer-surface-history-channels"
        links.new(uv.outputs["UV"], texture.inputs["Vector"])
        links.new(texture.outputs["Color"], separate.inputs["Color"])

        base = principled.inputs["Base Color"]
        roughness = principled.inputs["Roughness"]
        if response:
            base_source = base.links[0].from_socket if base.is_linked else None
            base_default = tuple(base.default_value)
            if base.is_linked:
                links.remove(base.links[0])
            current_color = base_source
            for response_name, output_name in zip(response_names, channel_outputs):
                response_value = response[response_name]
                signal_output = (
                    texture.outputs["Alpha"]
                    if output_name == "Alpha"
                    else separate.outputs[output_name]
                )
                scale = nodes.new("ShaderNodeMath")
                scale.operation = "MULTIPLY_ADD"
                scale.inputs[1].default_value = response_value["colorMultiplier"] - 1
                scale.inputs[2].default_value = 1
                links.new(signal_output, scale.inputs[0])
                multiply = nodes.new("ShaderNodeMixRGB")
                multiply.blend_type = "MULTIPLY"
                multiply.inputs[0].default_value = 1
                links.new(scale.outputs[0], multiply.inputs[2])
                if current_color:
                    links.new(current_color, multiply.inputs[1])
                else:
                    multiply.inputs[1].default_value = base_default
                current_color = multiply.outputs[0]
            links.new(current_color, base)

            current_roughness = roughness.links[0].from_socket if roughness.is_linked else None
            roughness_default = roughness.default_value
            if roughness.is_linked:
                links.remove(roughness.links[0])
            for response_name, output_name in zip(response_names, channel_outputs):
                signal_output = (
                    texture.outputs["Alpha"]
                    if output_name == "Alpha"
                    else separate.outputs[output_name]
                )
                delta = nodes.new("ShaderNodeMath")
                delta.operation = "MULTIPLY"
                delta.inputs[1].default_value = response[response_name]["roughnessOffset"]
                links.new(signal_output, delta.inputs[0])
                add = nodes.new("ShaderNodeMath")
                add.operation = "ADD"
                add.use_clamp = True
                if current_roughness:
                    links.new(current_roughness, add.inputs[0])
                else:
                    add.inputs[0].default_value = roughness_default
                links.new(delta.outputs[0], add.inputs[1])
                current_roughness = add.outputs[0]
            links.new(current_roughness, roughness)
        if dirt_image and dirt_response:
            dirt_texture = nodes.new("ShaderNodeTexImage")
            dirt_texture.name = "videoer-surface-dirt-mass-field"
            dirt_texture.image = dirt_image
            dirt_texture.interpolation = "Linear"
            dirt_texture.extension = "EXTEND"
            dirt_separate = nodes.new("ShaderNodeSeparateColor")
            dirt_separate.name = "videoer-surface-dirt-mass-channels"
            links.new(uv.outputs["UV"], dirt_texture.inputs["Vector"])
            links.new(dirt_texture.outputs["Color"], dirt_separate.inputs["Color"])
            current_color = base.links[0].from_socket if base.is_linked else None
            base_default = tuple(base.default_value)
            if base.is_linked:
                links.remove(base.links[0])
            for response_name, output_name in (("loose", "Red"), ("persistent", "Green")):
                scale = nodes.new("ShaderNodeMath")
                scale.operation = "MULTIPLY_ADD"
                scale.inputs[1].default_value = dirt_response[response_name]["colorMultiplier"] - 1
                scale.inputs[2].default_value = 1
                links.new(dirt_separate.outputs[output_name], scale.inputs[0])
                multiply = nodes.new("ShaderNodeMixRGB")
                multiply.blend_type = "MULTIPLY"
                multiply.inputs[0].default_value = 1
                if current_color:
                    links.new(current_color, multiply.inputs[1])
                else:
                    multiply.inputs[1].default_value = base_default
                links.new(scale.outputs[0], multiply.inputs[2])
                current_color = multiply.outputs[0]
            links.new(current_color, base)
            current_roughness = roughness.links[0].from_socket if roughness.is_linked else None
            roughness_default = roughness.default_value
            if roughness.is_linked:
                links.remove(roughness.links[0])
            for response_name, output_name in (("loose", "Red"), ("persistent", "Green")):
                delta = nodes.new("ShaderNodeMath")
                delta.operation = "MULTIPLY"
                delta.inputs[1].default_value = dirt_response[response_name]["roughnessOffset"]
                links.new(dirt_separate.outputs[output_name], delta.inputs[0])
                add = nodes.new("ShaderNodeMath")
                add.operation = "ADD"
                add.use_clamp = True
                if current_roughness:
                    links.new(current_roughness, add.inputs[0])
                else:
                    add.inputs[0].default_value = roughness_default
                links.new(delta.outputs[0], add.inputs[1])
                current_roughness = add.outputs[0]
            links.new(current_roughness, roughness)
        if response:
            response_materials.append(material_definition["id"])
        if dirt_response:
            dirt_response_materials.append(material_definition["id"])
    if schema_version != 3 and not response_materials and not dirt_response_materials:
        raise RuntimeError(
            f"Entity '{definition['id']}' has a surface-history field but no material history responses"
        )
    return {
        "entityId": definition["id"],
        "fieldId": field["id"],
        "fieldSha256": field["fieldSha256"],
        "schemaVersion": schema_version,
        "sourceWaterFieldSha256": field["sourceWaterField"]["fieldSha256"],
        "activeCellCount": field["grid"]["activeCellCount"],
        "historyResponseContract": response_contract,
        "responseMaterialIds": sorted(response_materials),
        "unmappedMaterialIds": sorted(unmapped_materials),
        **(
            {
                "opticalResponseMaterialIds": sorted(optical_materials),
                "transportOnlyMaterialIds": sorted(transport_only_materials),
            }
            if schema_version == 3
            else {}
        ),
        "trafficAffectedCellCount": sum(cell["trafficWear"] > 0 for cell in field["cells"]),
        "exposureAffectedCellCount": sum(cell[exposure_channel] > 0 for cell in field["cells"]),
        "runoffAffectedCellCount": sum(cell["runoffStaining"] > 0 for cell in field["cells"]),
        "repairAffectedCellCount": sum(cell["repairInfluence"] > 0 for cell in field["cells"]),
        **(
            {
                "dirtMassBalance": field["dirtMassBalance"],
                "dirtResponseMaterialIds": sorted(dirt_response_materials),
            }
            if schema_version in (2, 3)
            else {}
        ),
        **(
            {
                "rainExposedCellCount": sum(
                    cell["rainExposureFraction"] > 0 for cell in field["cells"]
                ),
                "shelterProtectedCellCount": sum(
                    cell["shelterProtection"] > 0 for cell in field["cells"]
                ),
                "runoffThroughflowAffectedCellCount": sum(
                    cell["runoffThroughflowStaining"] > 0 for cell in field["cells"]
                ),
                "retainedWaterAffectedCellCount": sum(
                    cell["retainedWaterStaining"] > 0 for cell in field["cells"]
                ),
            }
            if schema_version == 3
            else {}
        ),
    }


def create_ground_splashes(definition, fps, surface_water_fields=None):
    if not definition or not definition.get("enabled") or definition.get("count", 0) <= 0:
        return
    generator = random.Random(definition["seed"])
    material = create_translucent_vfx_material(
        "cinematic-ground-splash-material",
        definition["color"],
        definition["opacity"],
        0.12,
    )
    principled = material.node_tree.nodes.get("Principled BSDF")
    if principled:
        principled.inputs["Base Color"].default_value = (
            definition["color"][0] * 0.08,
            definition["color"][1] * 0.08,
            definition["color"][2] * 0.08,
            1,
        )
        if principled.inputs.get("Specular IOR Level"):
            principled.inputs["Specular IOR Level"].default_value = 0.5
        if principled.inputs.get("Transmission Weight"):
            principled.inputs["Transmission Weight"].default_value = 0.92
        if principled.inputs.get("IOR"):
            principled.inputs["IOR"].default_value = 1.333
    minimum = definition["boundsMinimum"]
    maximum = definition["boundsMaximum"]
    eligible = [
        (cell, water_field["cellSizeMeters"])
        for water_field in (surface_water_fields or [])
        for cell in water_field["splashEligibleCells"]
    ]
    if surface_water_fields is not None and not eligible:
        return
    lifetime_frames = max(3, round(definition["lifetimeSeconds"] * fps))
    for index in range(definition["count"]):
        radius = generator.uniform(definition["radiusMinimumMeters"], definition["radiusMaximumMeters"])
        vertices = []
        faces = []
        segments = 28
        radial_scales = (0.58, 0.72, 0.86, 1.0)
        crown_height = definition["crownHeightMeters"] * generator.uniform(0.62, 1.18)
        wave_heights = (0.0, crown_height * 0.11, crown_height * 0.035, 0.0)
        phase = generator.uniform(0, 2 * math.pi)
        for ring_index, radial_scale in enumerate(radial_scales):
            for segment in range(segments):
                angle = 2 * math.pi * segment / segments
                irregularity = 1 + 0.1 * math.sin(3 * angle + phase) + 0.045 * math.sin(7 * angle - phase)
                radial_distance = radius * radial_scale * irregularity
                vertices.append((
                    math.cos(angle) * radial_distance,
                    math.sin(angle) * radial_distance,
                    wave_heights[ring_index],
                ))
        for ring_index in range(len(radial_scales) - 1):
            inner_start = ring_index * segments
            outer_start = (ring_index + 1) * segments
            gap_a = generator.randrange(segments)
            gap_b = (gap_a + generator.randrange(8, 19)) % segments
            gap_width_a = generator.randrange(2, 5)
            gap_width_b = generator.randrange(2, 4)
            for segment in range(segments):
                distance_a = min((segment - gap_a) % segments, (gap_a - segment) % segments)
                distance_b = min((segment - gap_b) % segments, (gap_b - segment) % segments)
                if distance_a < gap_width_a or distance_b < gap_width_b:
                    continue
                next_segment = (segment + 1) % segments
                faces.append((
                    inner_start + segment,
                    inner_start + next_segment,
                    outer_start + next_segment,
                    outer_start + segment,
                ))

        # Add tiny volumetric droplets as octahedra in the same animated mesh.
        # They carry the declared crown height without producing drawn spokes.
        for _ in range(generator.randint(1, 2)):
            angle = generator.uniform(0, 2 * math.pi)
            radial_distance = radius * generator.uniform(0.35, 0.9)
            centre = (
                math.cos(angle) * radial_distance,
                math.sin(angle) * radial_distance,
                crown_height * generator.uniform(0.55, 1.0),
            )
            droplet_radius = max(0.00035, radius * generator.uniform(0.022, 0.04))
            start_vertex = len(vertices)
            vertices.extend([
                (centre[0] + droplet_radius, centre[1], centre[2]),
                (centre[0] - droplet_radius, centre[1], centre[2]),
                (centre[0], centre[1] + droplet_radius, centre[2]),
                (centre[0], centre[1] - droplet_radius, centre[2]),
                (centre[0], centre[1], centre[2] + droplet_radius),
                (centre[0], centre[1], centre[2] - droplet_radius),
            ])
            faces.extend([
                (start_vertex + 0, start_vertex + 2, start_vertex + 4),
                (start_vertex + 2, start_vertex + 1, start_vertex + 4),
                (start_vertex + 1, start_vertex + 3, start_vertex + 4),
                (start_vertex + 3, start_vertex + 0, start_vertex + 4),
                (start_vertex + 2, start_vertex + 0, start_vertex + 5),
                (start_vertex + 1, start_vertex + 2, start_vertex + 5),
                (start_vertex + 3, start_vertex + 1, start_vertex + 5),
                (start_vertex + 0, start_vertex + 3, start_vertex + 5),
            ])

        mesh = bpy.data.meshes.new(f"cinematic-splash-{index}")
        mesh.from_pydata(vertices, [], faces)
        mesh.materials.append(material)
        for polygon in mesh.polygons:
            polygon.use_smooth = True
        splash = bpy.data.objects.new(f"cinematic-splash-{index}", mesh)
        bpy.context.collection.objects.link(splash)
        if eligible:
            weights = [
                max(
                    1e-9,
                    cell["exposure"]
                    * (
                        cell["filmDepthMeters"]
                        + cell["edgeAccumulationDepthMeters"]
                        + cell["puddleDepthMeters"]
                    ),
                )
                for cell, _ in eligible
            ]
            cell, eligible_cell_size = generator.choices(eligible, weights=weights, k=1)[0]
            position = cell["worldPosition"]
            splash.location = to_blender(
                [
                    position[0] + generator.uniform(-0.4, 0.4) * eligible_cell_size,
                    position[1]
                    + cell["filmDepthMeters"]
                    + cell["edgeAccumulationDepthMeters"]
                    + cell["puddleDepthMeters"]
                    + 0.001,
                    position[2] + generator.uniform(-0.4, 0.4) * eligible_cell_size,
                ]
            )
        else:
            splash.location = to_blender([
                generator.uniform(minimum[0], maximum[0]),
                generator.uniform(minimum[1], maximum[1]),
                generator.uniform(minimum[2], maximum[2]),
            ])
        start = 1 + generator.randrange(max(1, lifetime_frames))
        splash.scale = (0.08, 0.08, 0.08)
        splash.keyframe_insert(data_path="scale", frame=start)
        splash.scale = (1.0, 1.0, 1.0)
        splash.keyframe_insert(data_path="scale", frame=start + lifetime_frames // 2)
        splash.scale = (1.32, 1.32, 0.06)
        splash.keyframe_insert(data_path="scale", frame=start + lifetime_frames)
        for fcurve in splash.animation_data.action.fcurves:
            for point in fcurve.keyframe_points:
                point.interpolation = "LINEAR"
            fcurve.modifiers.new(type="CYCLES")


def create_rain(definition, camera, fps, surface_water_fields=None):
    if not definition.get("enabled") or definition.get("count", 0) <= 0:
        if not definition.get("layers"):
            return
    if definition.get("layers"):
        wind = definition.get("windMetersPerSecond", (0, 0))
        for layer in definition["layers"]:
            create_camera_relative_rain(layer, camera, fps, wind)
        create_ground_splashes(
            definition.get("groundSplashes"), fps, surface_water_fields
        )
        return
    generator = random.Random(definition.get("seed", 1))
    minimum = definition["boundsMinimum"]
    maximum = definition["boundsMaximum"]
    streak_length = definition.get("streakLengthMeters", 0.14)
    curve_data = bpy.data.curves.new("cinematic-rain", type="CURVE")
    curve_data.dimensions = "3D"
    curve_data.bevel_depth = 0.0035
    curve_data.bevel_resolution = 0
    for _ in range(definition.get("count", 0)):
        start = [generator.uniform(minimum[axis], maximum[axis]) for axis in range(3)]
        end = [start[0] - streak_length * 0.08, start[1] - streak_length, start[2]]
        spline = curve_data.splines.new("POLY")
        spline.points.add(1)
        for point, coordinate in zip(spline.points, (to_blender(start), to_blender(end))):
            point.co = (*coordinate, 1)
    rain = bpy.data.objects.new("cinematic-rain", curve_data)
    bpy.context.collection.objects.link(rain)
    material = create_translucent_vfx_material(
        "cinematic-rain-material", (0.32, 0.55, 0.78), 0.58, 0.18
    )
    curve_data.materials.append(material)
    distance = maximum[1] - minimum[1] + streak_length
    cycle_seconds = distance / definition.get("fallSpeedMetersPerSecond", 8)
    rain.location = (0, 0, 0)
    rain.keyframe_insert(data_path="location", frame=1)
    rain.location.z = -distance
    rain.keyframe_insert(data_path="location", frame=max(2, round(cycle_seconds * fps) + 1))
    action = rain.animation_data.action
    for curve in action.fcurves:
        for point in curve.keyframe_points:
            point.interpolation = "LINEAR"
        curve.modifiers.new(type="CYCLES")


def create_smoke_volume_material(layer):
    material = bpy.data.materials.new(f"aerosol-{layer['id']}-volume")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    volume = nodes.new("ShaderNodeVolumePrincipled")
    volume.inputs["Color"].default_value = (*layer["color"], 1)
    volume.inputs["Anisotropy"].default_value = layer.get("anisotropy", 0.1)
    coordinates = nodes.new("ShaderNodeTexCoord")
    texture = nodes.new("ShaderNodeTexNoise")
    texture.name = f"aerosol-{layer['id']}-density-noise"
    texture.noise_dimensions = "4D"
    average_radius = (
        layer["particleRadiusMeters"]["minimum"]
        + layer["particleRadiusMeters"]["maximum"]
    ) * 0.5
    texture.inputs["Scale"].default_value = max(
        1.0, average_radius / layer["noiseScaleMeters"] * 5.0
    )
    texture.inputs["Detail"].default_value = layer.get("noiseDetail", 4)
    texture.inputs["Roughness"].default_value = 0.7
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.28
    ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
    ramp.color_ramp.elements[1].position = 0.6
    ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
    density = nodes.new("ShaderNodeMath")
    density.operation = "MULTIPLY"
    density.inputs[1].default_value = layer["density"] * layer["opacity"]
    links.new(coordinates.outputs["Generated"], texture.inputs["Vector"])
    links.new(texture.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], density.inputs[0])
    links.new(density.outputs[0], volume.inputs["Density"])
    links.new(volume.outputs["Volume"], output.inputs["Volume"])
    return material


def create_aerosol_particle_mesh(name, subdivisions=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1.0)
    template = bpy.context.object
    template.name = name
    mesh = template.data
    bpy.data.objects.remove(template, do_unlink=True)
    return mesh


def create_smoke_plume_mesh(layer, generator):
    segments = 18
    ring_count = 11
    vertices = []
    faces = []
    phase = generator.uniform(0, 2 * math.pi)
    base_radius = layer["sourceRadiusMeters"] + (
        layer["particleRadiusMeters"]["minimum"]
        + layer["particleRadiusMeters"]["maximum"]
    ) * 0.32
    for ring in range(ring_count):
        progress = ring / (ring_count - 1)
        vertical = progress * layer["verticalSpanMeters"]
        envelope = 0.42 + 0.72 * math.sin(math.pi * progress) ** 0.72
        envelope *= 1 + 0.14 * math.sin(progress * math.pi * 5 + phase)
        centre_x = (
            layer["windMetersPerSecond"][0] * progress * 0.85
            + layer["turbulenceMeters"] * 0.55 * math.sin(progress * math.pi * 3 + phase)
        )
        centre_y = (
            layer["windMetersPerSecond"][2] * progress * 0.85
            + layer["turbulenceMeters"] * 0.42 * math.sin(progress * math.pi * 4.2 - phase)
        )
        for segment in range(segments):
            angle = 2 * math.pi * segment / segments
            irregularity = (
                1
                + 0.13 * math.sin(angle * 3 + phase + progress * 4.2)
                + 0.07 * math.sin(angle * 7 - phase * 0.6 + progress * 6.1)
            )
            radius = base_radius * envelope * irregularity
            vertices.append((
                centre_x + math.cos(angle) * radius,
                centre_y + math.sin(angle) * radius,
                vertical,
            ))
    for ring in range(ring_count - 1):
        for segment in range(segments):
            next_segment = (segment + 1) % segments
            lower = ring * segments + segment
            upper = (ring + 1) * segments + segment
            faces.append((
                lower,
                ring * segments + next_segment,
                (ring + 1) * segments + next_segment,
                upper,
            ))
    bottom = len(vertices)
    vertices.append((0, 0, 0))
    top = len(vertices)
    top_ring = (ring_count - 1) * segments
    top_centre = [
        sum(vertices[top_ring + segment][axis] for segment in range(segments)) / segments
        for axis in range(2)
    ]
    vertices.append((top_centre[0], top_centre[1], layer["verticalSpanMeters"]))
    for segment in range(segments):
        next_segment = (segment + 1) % segments
        faces.append((bottom, next_segment, segment))
        faces.append((top, top_ring + segment, top_ring + next_segment))
    mesh = bpy.data.meshes.new(f"aerosol-{layer['id']}-plume-domain")
    mesh.from_pydata(vertices, [], faces)
    return mesh


def animate_aerosol_particle(obj, layer, generator, fps, particle_index, radius):
    lifetime_frames = max(4, round(layer["lifetimeSeconds"] * fps))
    start_frame = 1 - generator.randrange(lifetime_frames)
    angle = generator.uniform(0, 2 * math.pi)
    radial = layer["sourceRadiusMeters"] * math.sqrt(generator.random())
    spawn = [
        layer["origin"][0] + math.cos(angle) * radial,
        layer["origin"][1],
        layer["origin"][2] + math.sin(angle) * radial,
    ]
    speed = generator.uniform(
        layer["riseSpeedMetersPerSecond"]["minimum"],
        layer["riseSpeedMetersPerSecond"]["maximum"],
    )
    turbulence_phase = generator.uniform(0, 2 * math.pi)
    sample_fractions = (0.0, 0.22, 0.55, 0.82, 1.0)
    for progress in sample_fractions:
        age = progress * layer["lifetimeSeconds"]
        lateral = layer["turbulenceMeters"] * math.sin(
            progress * math.pi * 3.4 + turbulence_phase
        )
        secondary = layer["turbulenceMeters"] * 0.62 * math.sin(
            progress * math.pi * 4.6 - turbulence_phase * 0.7
        )
        position = [
            spawn[0] + layer["windMetersPerSecond"][0] * age + lateral,
            spawn[1]
            + min(layer["verticalSpanMeters"], max(0.0, speed * age))
            + layer["windMetersPerSecond"][1] * age,
            spawn[2] + layer["windMetersPerSecond"][2] * age + secondary,
        ]
        obj.location = to_blender(position)
        if layer["kind"] == "smoke-volume":
            scale_factor = (
                0.04
                if progress in (0.0, 1.0)
                else 0.7 + progress * 0.9
            )
            obj.scale = (
                radius * scale_factor,
                radius * scale_factor,
                radius * scale_factor * 1.18,
            )
        else:
            visibility = min(1.0, progress * 8.0, (1.0 - progress) * 8.0)
            trail = layer.get("trailLengthMeters", 0.0)
            obj.scale = (
                radius * visibility,
                radius * visibility,
                (radius + trail) * visibility,
            )
        frame = start_frame + round(progress * lifetime_frames)
        obj.keyframe_insert(data_path="location", frame=frame)
        obj.keyframe_insert(data_path="scale", frame=frame)
    action = obj.animation_data.action
    for curve in action.fcurves:
        for point in curve.keyframe_points:
            point.interpolation = "BEZIER"
        curve.modifiers.new(type="CYCLES")
    return {
        "particleIndex": particle_index,
        "startFrame": start_frame,
        "lifetimeFrames": lifetime_frames,
        "radiusMeters": radius,
        "riseSpeedMetersPerSecond": speed,
        "spawnPosition": spawn,
    }


def create_aerosols(instances, fps, frame_count, output):
    report = []
    for instance in instances:
        source = instance["source"]
        layer = dict(instance["layer"])
        layer["origin"] = instance["origin"]
        generator = random.Random(layer["seed"])
        if layer["kind"] == "smoke-volume":
            volume_sequence = openvdb_smoke.create_sparse_smoke_sequence(
                layer,
                output,
                fps,
                frame_count,
                geometry_probe.to_blender,
            )
            particles = volume_sequence["sourceParcels"]
        elif layer["kind"] == "ember-particles":
            material = create_translucent_vfx_material(
                f"aerosol-{layer['id']}-material",
                layer["color"],
                layer["opacity"],
                0.2,
                layer["emissionStrength"],
            )
            mesh = create_aerosol_particle_mesh(f"aerosol-{layer['id']}-template", 1)
        else:
            material = create_translucent_vfx_material(
                f"aerosol-{layer['id']}-material",
                layer["color"],
                layer["opacity"],
                layer["roughness"],
            )
            mesh = create_aerosol_particle_mesh(f"aerosol-{layer['id']}-template", 1)
        if layer["kind"] != "smoke-volume":
            mesh.materials.append(material)
            particles = []
            for particle_index in range(layer["count"]):
                radius = generator.uniform(
                    layer["particleRadiusMeters"]["minimum"],
                    layer["particleRadiusMeters"]["maximum"],
                )
                particle = bpy.data.objects.new(
                    f"aerosol-{layer['id']}-{particle_index:03d}", mesh
                )
                bpy.context.collection.objects.link(particle)
                particles.append(
                    animate_aerosol_particle(
                        particle, layer, generator, fps, particle_index, radius
                    )
                )
        origin_distance = math.sqrt(
            sum(
                (instance["origin"][axis] - source["resolvedAttachmentPosition"][axis]) ** 2
                for axis in range(3)
            )
        )
        report.append({
            "layerId": layer["id"],
            "kind": layer["kind"],
            "seed": layer["seed"],
            "declaredCount": layer["count"],
            "generatedCount": len(particles),
            "source": source,
            "origin": instance["origin"],
            "originDistanceFromAttachmentMeters": origin_distance,
            "particles": particles,
            **({"volumeSequence": volume_sequence} if layer["kind"] == "smoke-volume" else {}),
        })
    return report


def configure_scene(manifest):
    global color_management_report, world_configuration_report
    scene = bpy.context.scene
    render_profile = manifest["renderProfile"]
    if (
        render_profile["engine"] == "eevee-next"
        and manifest.get("environmentIllumination") is not None
    ):
        raise RuntimeError(
            "Eevee Next cannot consume reflection-bearing environment illumination: "
            "Cycles is required until a renderer-independent Eevee light-probe bake contract exists"
        )
    if render_profile["engine"] == "cycles-cpu":
        scene.render.engine = "CYCLES"
        scene.cycles.device = "CPU"
        scene.cycles.samples = render_profile["samples"]
        scene.cycles.seed = render_profile["seed"]
        scene.cycles.use_animated_seed = False
        scene.cycles.use_denoising = render_profile["denoise"]
        scene.cycles.use_adaptive_sampling = False
        if render_profile["denoise"]:
            scene.cycles.denoiser = "OPENIMAGEDENOISE"
        # Cycles' per-pixel seeded CPU integrator is repeatable across independent processes and
        # thread schedules. Eevee Next's Metal virtual-shadow-map path is not, so it is reserved
        # for explicitly declared previews rather than content-addressed production evidence.
        scene.render.threads_mode = "AUTO"
    elif render_profile["engine"] == "eevee-next":
        if render_profile["intent"] != "preview":
            raise RuntimeError("Eevee Next is only valid for non-authoritative preview renders")
        scene.render.engine = "BLENDER_EEVEE_NEXT"
        scene.eevee.taa_render_samples = render_profile["samples"]
    else:
        raise RuntimeError(f"Unsupported cinematic render engine: {render_profile['engine']}")
    scene.render.resolution_x = manifest["resolution"]["width"]
    scene.render.resolution_y = manifest["resolution"]["height"]
    scene.render.resolution_percentage = manifest["resolution"].get("percentage", 100)
    scene.render.fps = manifest["fps"]
    scene.frame_start = 1
    scene.frame_end = round(manifest["durationSeconds"] * manifest["fps"])
    world_configuration_report = configure_world(
        scene,
        manifest["atmosphere"]["worldColor"],
        environment_illumination=manifest.get("environmentIllumination"),
    )
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 15
    # Blender's default output dither changes 8-bit pixels between otherwise identical renders.
    # Production evidence must be content-addressable, so disable the final colour perturbation.
    scene.render.dither_intensity = 0.0
    scene.render.film_transparent = False
    exposure = manifest.get("exposure") or {
        "viewTransform": "AgX",
        "look": "AgX - Medium High Contrast",
        "exposureStops": 0,
    }
    if not isinstance(exposure, dict):
        raise RuntimeError("Cinematic exposure contract must be an object")
    if exposure.get("viewTransform") != "AgX":
        raise RuntimeError(
            f"Unsupported cinematic view transform: {exposure.get('viewTransform')}"
        )
    if exposure.get("look") != "AgX - Medium High Contrast":
        raise RuntimeError(f"Unsupported cinematic AgX look: {exposure.get('look')}")
    exposure_stops = exposure.get("exposureStops", 0)
    if (
        not isinstance(exposure_stops, (int, float))
        or not math.isfinite(exposure_stops)
        or exposure_stops < -4
        or exposure_stops > 4
    ):
        raise RuntimeError("Cinematic exposure must be within -4 to 4 stops")
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = exposure_stops
    color_management_report = {
        "viewTransform": scene.view_settings.view_transform,
        "look": scene.view_settings.look,
        "exposureStops": scene.view_settings.exposure,
    }
    return scene


def projected_entity_bounds(scene, camera, mesh):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = mesh.evaluated_get(depsgraph)
    evaluated_mesh = evaluated.to_mesh()
    try:
        points = [
            world_to_camera_view(scene, camera, evaluated.matrix_world @ vertex.co)
            for vertex in evaluated_mesh.vertices
        ]
    finally:
        evaluated.to_mesh_clear()
    in_front = [point for point in points if point.z > 0]
    if not in_front:
        return None
    minimum_x = min(point.x for point in in_front)
    maximum_x = max(point.x for point in in_front)
    minimum_y = min(point.y for point in in_front)
    maximum_y = max(point.y for point in in_front)
    return {
        "minimumX": minimum_x,
        "maximumX": maximum_x,
        "minimumY": minimum_y,
        "maximumY": maximum_y,
        "widthPercentage": (maximum_x - minimum_x) * 100,
        "heightPercentage": (maximum_y - minimum_y) * 100,
    }


def write_framing_report(scene, camera, entity_meshes, manifest, output):
    samples = []
    camera_contract_samples = []
    target = camera.constraints["semantic-camera-target"].target
    maximum_position_error = 0
    maximum_target_error = 0
    maximum_lens_error = 0
    for landmark in manifest["landmarks"]:
        frame = min(round(landmark["progress"] * (scene.frame_end - 1)) + 1, scene.frame_end)
        scene.frame_set(frame)
        time = ((frame - 1) / (scene.frame_end - 1)) * manifest["durationSeconds"]
        expected = sample_semantic_camera(manifest["camera"], time)
        position_error = (camera.location - to_blender(expected["position"])).length
        target_error = (target.location - to_blender(expected["target"])).length
        lens_error = abs(camera.data.lens - expected["lensMillimeters"])
        maximum_position_error = max(maximum_position_error, position_error)
        maximum_target_error = max(maximum_target_error, target_error)
        maximum_lens_error = max(maximum_lens_error, lens_error)
        camera_contract_samples.append({
            "landmarkId": landmark["id"],
            "frame": frame,
            "positionErrorMeters": position_error,
            "targetErrorMeters": target_error,
            "lensErrorMillimeters": lens_error,
            "actualLensMillimeters": camera.data.lens,
            "expectedLensMillimeters": expected["lensMillimeters"],
        })
        samples.append({
            "landmarkId": landmark["id"],
            "progress": landmark["progress"],
            "frame": frame,
            "entities": {
                entity_id: projected_entity_bounds(scene, camera, mesh)
                for entity_id, mesh in entity_meshes.items()
            },
        })
    with open(os.path.join(output, "framing-report.json"), "w", encoding="utf-8") as handle:
        json.dump({
            "schemaVersion": 1,
            "cameraContract": {
                "valid": maximum_position_error <= 1e-5
                    and maximum_target_error <= 1e-5
                    and maximum_lens_error <= 0.005,
                "trackingConstraint": "TRACK_TO",
                "trackAxis": "TRACK_NEGATIVE_Z",
                "upAxis": "UP_Y",
                "interpolationImplementation": "frame-baked-declarative-v1",
                "maximumPositionErrorMeters": maximum_position_error,
                "maximumTargetErrorMeters": maximum_target_error,
                "maximumLensErrorMillimeters": maximum_lens_error,
                "positionToleranceMeters": 1e-5,
                "targetToleranceMeters": 1e-5,
                "lensToleranceMillimeters": 0.005,
                "samples": camera_contract_samples,
            },
            "samples": samples,
        }, handle, indent=2)
        handle.write("\n")


def main():
    manifest_file, output, mode = arguments()
    os.makedirs(output, exist_ok=True)
    manifest = load_json(manifest_file)
    geometry_probe.clear_scene()
    scene = configure_scene(manifest)
    entity_meshes = {}
    surface_water_fields = []
    surface_history_fields = []
    for entity in manifest["entities"]:
        asset, armature, mesh = create_entity(entity, manifest["fps"], manifest["durationSeconds"])
        entity_meshes[entity["id"]] = mesh
        if entity.get("surfaceHistoryFieldPath"):
            if not entity.get("surfaceWaterFieldPath"):
                raise RuntimeError(
                    f"Entity '{entity['id']}' cannot render surface history without its source water"
                )
            surface_history_fields.append(create_surface_history(entity, asset, mesh))
        if entity.get("surfaceWaterFieldPath"):
            field_report = create_surface_water(entity, asset, mesh)
            if entity.get("surfaceWaterOpticalSurfacePath"):
                field_report["opticalSurface"] = create_surface_water_optical_surface(
                    entity, field_report
                )
            surface_water_fields.append(field_report)
        elif entity.get("surfaceWaterOpticalSurfacePath"):
            raise RuntimeError(
                f"Entity '{entity['id']}' cannot render an optical water surface without its source field"
            )
        if entity.get("fixturePath"):
            create_fixture_lights(entity, entity["id"], asset, armature, mesh)
    with open(
        os.path.join(output, "surface-water-report.json"),
        "w",
        encoding="utf-8",
    ) as handle:
        json.dump(
            {
                "schemaVersion": 1,
                "sceneId": manifest["id"],
                "fields": [
                    {key: value for key, value in field.items() if key != "splashEligibleCells"}
                    for field in surface_water_fields
                ],
            },
            handle,
            indent=2,
        )
        handle.write("\n")
    with open(
        os.path.join(output, "surface-history-report.json"),
        "w",
        encoding="utf-8",
    ) as handle:
        json.dump(
            {
                "schemaVersion": 1,
                "sceneId": manifest["id"],
                "fields": surface_history_fields,
            },
            handle,
            indent=2,
        )
        handle.write("\n")
    with open(
        os.path.join(output, "fixture-modulation-report.json"),
        "w",
        encoding="utf-8",
    ) as handle:
        json.dump(
            {
                "schemaVersion": 1,
                "sceneId": manifest["id"],
                "fps": manifest["fps"],
                "frameCount": scene.frame_end,
                "emitters": fixture_modulation_reports,
            },
            handle,
            indent=2,
        )
        handle.write("\n")
    with open(
        os.path.join(output, "production-character-assembly-report.json"),
        "w",
        encoding="utf-8",
    ) as handle:
        json.dump(
            {
                "schemaVersion": 1,
                "sceneId": manifest["id"],
                "assemblies": production_character_reports,
            },
            handle,
            indent=2,
        )
        handle.write("\n")
    camera = create_camera(scene, manifest["camera"], manifest["fps"])
    lighting_modulation_reports = create_lights(manifest["lights"], entity_meshes)
    with open(
        os.path.join(output, "lighting-modulation-report.json"),
        "w",
        encoding="utf-8",
    ) as handle:
        json.dump(
            {
                "schemaVersion": 1,
                "sceneId": manifest["id"],
                "fps": manifest["fps"],
                "frameCount": scene.frame_end,
                "lights": lighting_modulation_reports,
            },
            handle,
            indent=2,
        )
        handle.write("\n")
    create_rain(
        manifest["atmosphere"]["rain"],
        camera,
        manifest["fps"],
        surface_water_fields if surface_water_fields else None,
    )
    aerosol_report = create_aerosols(
        manifest["atmosphere"].get("aerosols", []),
        manifest["fps"],
        scene.frame_end,
        output,
    )
    with open(
        os.path.join(output, "aerosol-report.json"), "w", encoding="utf-8"
    ) as handle:
        json.dump(
            {
                "schemaVersion": 1,
                "sceneId": manifest["id"],
                "layers": aerosol_report,
            },
            handle,
            indent=2,
        )
        handle.write("\n")
    # Resolve the final fog envelope only after rain splashes and aerosol particles exist.
    # Their animated render meshes must participate in the same every-frame containment proof
    # as ordinary scene entities.
    fog_report = create_fog(
        scene,
        manifest["atmosphere"].get("fogDensity", 0),
        manifest["atmosphere"].get("fogColor", (0.16, 0.2, 0.28)),
        manifest.get("finiteFogDomain"),
    )
    with open(os.path.join(output, "world-report.json"), "w", encoding="utf-8") as handle:
        json.dump(
            {
                "schemaVersion": 1,
                "sceneId": manifest["id"],
                "surface": world_configuration_report,
                "fog": fog_report,
                "colorManagement": color_management_report,
            },
            handle,
            indent=2,
        )
        handle.write("\n")
    write_framing_report(scene, camera, entity_meshes, manifest, output)
    if mode == "inspect-only":
        return
    filename = manifest["id"].split(".")[-1]
    if mode == "probe":
        probes_directory = os.path.join(output, "probe-frames")
        os.makedirs(probes_directory, exist_ok=True)
        for landmark in manifest["landmarks"]:
            frame = min(
                round(landmark["progress"] * (scene.frame_end - 1)) + 1,
                scene.frame_end,
            )
            scene.frame_set(frame)
            percentage = str(round(landmark["progress"] * 100)).zfill(3)
            scene.render.filepath = os.path.join(
                probes_directory,
                f"{percentage}-{landmark['id']}.png",
            )
            bpy.ops.render.render(write_still=True)
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(output, f"{filename}.blend"))
        return
    frames_directory = os.path.join(output, "lossless-frames")
    os.makedirs(frames_directory, exist_ok=True)
    scene.render.filepath = os.path.join(frames_directory, f"{filename}-")
    bpy.ops.render.render(animation=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(output, f"{filename}.blend"))


geometry_probe = load_module("render_geometry_probe.py", "videoer_geometry_probe")
motion_probe = load_module("render_motion_probe.py", "videoer_motion_probe")
interaction_probe = load_module("render_interaction_probe.py", "videoer_interaction_probe")
rigify_adapter = load_module("render_mpfb_motion_probe.py", "videoer_mpfb_rigify_adapter")
production_character_assembly = load_module(
    "production_character_assembly.py", "videoer_production_character_assembly"
)
openvdb_smoke = load_module("openvdb_smoke.py", "videoer_openvdb_smoke")

if __name__ == "__main__":
    main()
