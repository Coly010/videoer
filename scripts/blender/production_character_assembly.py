"""Blender adapter for a renderer-independent production-character binding."""

import hashlib
import json
import os

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree


CANONICAL_SKELETON = "videoer.canonical-humanoid-52"


def load_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def component_path(binding_path, component):
    path = os.path.abspath(os.path.join(os.path.dirname(binding_path), component["path"]))
    if sha256_file(path) != component["sha256"]:
        raise RuntimeError(f"Production-character artifact hash mismatch: {path}")
    return path


def ordered_joints(asset):
    return [joint["id"] for joint in asset.get("skeleton", [])]


def validate_skinned_component(asset, body, label):
    if ordered_joints(asset) != ordered_joints(body):
        raise RuntimeError(f"{label} does not own the body's complete ordered canonical skeleton")
    positions = asset.get("positions", [])
    indices = asset.get("indices", [])
    skin_indices = asset.get("skinIndices", [])
    skin_weights = asset.get("skinWeights", [])
    if not positions or len(indices) % 3 != 0:
        raise RuntimeError(f"{label} has invalid or empty triangle geometry")
    if len(skin_indices) != len(positions) or len(skin_weights) != len(positions):
        raise RuntimeError(f"{label} does not provide skin ownership for every vertex")
    joint_count = len(ordered_joints(body))
    for vertex_index, (owners, weights) in enumerate(zip(skin_indices, skin_weights)):
        if len(owners) != len(weights) or not owners:
            raise RuntimeError(f"{label} vertex {vertex_index} has malformed skin ownership")
        total = 0.0
        for owner, weight in zip(owners, weights):
            if owner < 0 or owner >= joint_count or weight < 0:
                raise RuntimeError(f"{label} vertex {vertex_index} has an invalid skin influence")
            total += weight
        if abs(total - 1.0) > 0.001:
            raise RuntimeError(f"{label} vertex {vertex_index} skin weights are not normalized")


def validate_binding(binding_path, definition, binding, body, profile):
    if binding.get("schemaVersion") != 1:
        raise RuntimeError("Unsupported production-character binding schema")
    compatibility = binding.get("compatibility", {})
    if compatibility.get("canonicalSkeleton") != CANONICAL_SKELETON:
        raise RuntimeError("Production-character binding has an incompatible canonical skeleton")
    if body.get("metadata", {}).get("topology") != compatibility.get("bodyTopology"):
        raise RuntimeError("Production-character body topology does not match its binding")
    body_path = component_path(binding_path, binding["body"])
    profile_path = component_path(binding_path, binding["rigProfile"])
    if os.path.realpath(body_path) != os.path.realpath(definition["geometryPath"]):
        raise RuntimeError("Production-character binding does not own the scene body geometry")
    if os.path.realpath(profile_path) != os.path.realpath(definition["productionRigProfilePath"]):
        raise RuntimeError("Production-character binding does not own the scene Rigify profile")
    if profile.get("canonicalSkeleton") != CANONICAL_SKELETON:
        raise RuntimeError("Production-character Rigify profile has an incompatible skeleton")
    if set(profile.get("canonicalToControl", {})) != set(ordered_joints(body)):
        raise RuntimeError("Production-character Rigify profile does not map the complete body skeleton")


def surface_geometry_material(target, surface):
    colors = surface["baseColor"]["colors"]
    base_color = [sum(color[channel] for color in colors) / len(colors) for channel in range(4)]
    return {
        "id": target,
        "baseColor": base_color,
        "metallic": surface.get("metallic", 0),
        "roughness": (surface["roughness"]["minimum"] + surface["roughness"]["maximum"]) / 2,
        "surface": surface,
    }


def apply_material_bindings(binding_path, binding, body_asset, body_mesh, geometry_probe):
    source_material_ids = {item["id"] for item in body_asset.get("materials", [])}
    applied = []
    for item in binding.get("materialBindings", []):
        target = item["targetMaterialId"]
        if target not in source_material_ids:
            raise RuntimeError(f"Bound body material target '{target}' does not exist")
        material_path = component_path(binding_path, item["material"])
        surface = load_json(material_path)
        material = geometry_probe.create_material(
            surface_geometry_material(target, surface), os.path.dirname(material_path)
        )
        # MPFB's hm08 body is one authored object but may expose several legacy slots.
        # A skin contract replaces only a semantic skin/body slot; an exact triangle
        # material map is required for any other target.
        matching = [
            index
            for index, current in enumerate(body_mesh.data.materials)
            if current and (target in current.name.lower() or (target == "skin" and "body" in current.name.lower()))
        ]
        if not matching and target == "skin" and len(body_mesh.data.materials) == 1:
            matching = [0]
        if not matching:
            raise RuntimeError(
                f"MPFB body has no unambiguous material slot for semantic target '{target}'"
            )
        for index in matching:
            body_mesh.data.materials[index] = material
        applied.append({"targetMaterialId": target, "slots": matching})
    return applied


def backend_converter(profile):
    conversion = Matrix(profile["transfer"]["coordinateConversion"]["matrix"])

    def convert(value):
        return conversion.to_3x3() @ Vector(value)

    return convert


def bind_hair(binding_path, component, body, armature, profile, geometry_probe):
    asset = load_json(component_path(binding_path, component))
    validate_skinned_component(asset, body, "Production hair")
    joint_ids = ordered_joints(body)
    head_index = joint_ids.index("head")
    for vertex_index, (owners, weights) in enumerate(zip(asset["skinIndices"], asset["skinWeights"])):
        active = {owner for owner, weight in zip(owners, weights) if weight > 0.000001}
        if active != {head_index}:
            raise RuntimeError(
                f"Production hair vertex {vertex_index} violates canonical-head-v1 ownership"
            )
    source_target = asset.get("metadata", {}).get("sourceTarget")
    if source_target != body["id"]:
        raise RuntimeError("Production hair was not fitted to the bound body identity")
    mesh = geometry_probe.create_mesh(
        asset,
        None,
        os.path.dirname(component_path(binding_path, component)),
        backend_converter(profile),
    )
    mesh.name = f"{armature.name}-hair"
    control = profile["canonicalToControl"]["head"]
    if armature.pose.bones.get(control) is None:
        raise RuntimeError(f"Generated Rigify armature lacks hair control '{control}'")
    rest_world = mesh.matrix_world.copy()
    mesh.parent = armature
    mesh.parent_type = "BONE"
    mesh.parent_bone = control
    mesh.matrix_world = rest_world
    return mesh, {"assetId": asset["id"], "binding": component["binding"], "control": control}


def barycentric(point, first, second, third):
    edge_a = second - first
    edge_b = third - first
    relative = point - first
    aa = edge_a.dot(edge_a)
    ab = edge_a.dot(edge_b)
    bb = edge_b.dot(edge_b)
    pa = relative.dot(edge_a)
    pb = relative.dot(edge_b)
    denominator = aa * bb - ab * ab
    if abs(denominator) < 1e-14:
        return (1.0, 0.0, 0.0)
    second_weight = (bb * pa - ab * pb) / denominator
    third_weight = (aa * pb - ab * pa) / denominator
    return (1.0 - second_weight - third_weight, second_weight, third_weight)


def transfer_body_weights(body_mesh, garment, armature):
    body_mesh.data.calc_loop_triangles()
    body_vertices = [vertex.co.copy() for vertex in body_mesh.data.vertices]
    deform_names = {bone.name for bone in armature.data.bones if bone.use_deform}
    source_groups = {group.index: group.name for group in body_mesh.vertex_groups if group.name in deform_names}
    if not source_groups:
        raise RuntimeError("MPFB body exposes no Rigify deform-weight groups")
    target_groups = {name: garment.vertex_groups.new(name=name) for name in source_groups.values()}
    source_weights = []
    for vertex in body_mesh.data.vertices:
        source_weights.append(
            {source_groups[item.group]: item.weight for item in vertex.groups if item.group in source_groups}
        )
    triangles = [
        tuple(triangle.vertices)
        for triangle in body_mesh.data.loop_triangles
        if all(source_weights[index] for index in triangle.vertices)
    ]
    if not triangles:
        raise RuntimeError("MPFB body has no fully deform-owned surface triangles")
    tree = BVHTree.FromPolygons(body_vertices, triangles, all_triangles=True)
    maximum_distance = 0.0
    minimum_influences = None
    transfer_distances = []
    for vertex in garment.data.vertices:
        nearest, _normal, triangle_index, distance = tree.find_nearest(vertex.co)
        if nearest is None:
            raise RuntimeError(f"Wardrobe vertex {vertex.index} has no body surface correspondence")
        maximum_distance = max(maximum_distance, distance)
        transfer_distances.append(distance)
        triangle = triangles[triangle_index]
        blend = barycentric(nearest, *(body_vertices[index] for index in triangle))
        combined = {}
        for corner, factor in zip(triangle, blend):
            for name, weight in source_weights[corner].items():
                combined[name] = combined.get(name, 0.0) + max(0.0, factor) * weight
        total = sum(combined.values())
        if total <= 0.000001:
            raise RuntimeError(f"Wardrobe vertex {vertex.index} received no Rigify deform ownership")
        active = 0
        for name, weight in combined.items():
            normalized = weight / total
            if normalized > 0.000001:
                target_groups[name].add([vertex.index], normalized, "REPLACE")
                active += 1
        minimum_influences = active if minimum_influences is None else min(minimum_influences, active)
    return maximum_distance, minimum_influences or 0, transfer_distances


def bind_wardrobe(binding_path, component, body, body_mesh, armature, profile, geometry_probe):
    asset = load_json(component_path(binding_path, component))
    validate_skinned_component(asset, body, "Production wardrobe")
    metadata = asset.get("metadata", {})
    if metadata.get("sourceTarget") != body["id"] and metadata.get("targetGeometry") != body["id"]:
        raise RuntimeError("Production wardrobe was not fitted to the bound body identity")
    mesh = geometry_probe.create_mesh(
        asset,
        None,
        os.path.dirname(component_path(binding_path, component)),
        backend_converter(profile),
    )
    mesh.name = f"{armature.name}-wardrobe-{asset['id'].split('.')[-1]}"
    # Discard canonical groups only after validating their complete ownership;
    # the generated Rigify deform groups come from the actual MPFB body surface.
    for group in list(mesh.vertex_groups):
        mesh.vertex_groups.remove(group)
    maximum_distance, minimum_influences, transfer_distances = transfer_body_weights(
        body_mesh, mesh, armature
    )
    region_definitions = metadata.get("weightTransferRegions")
    if not isinstance(region_definitions, list) or not region_definitions:
        raise RuntimeError("Production wardrobe lacks declared weight-transfer regions")
    covered = set()
    region_reports = []
    for region in region_definitions:
        start = region.get("startVertex")
        count = region.get("vertexCount")
        threshold = region.get("maximumDistanceMeters")
        if (
            not isinstance(start, int)
            or not isinstance(count, int)
            or count <= 0
            or start < 0
            or start + count > len(transfer_distances)
            or not isinstance(threshold, (int, float))
            or threshold <= 0
        ):
            raise RuntimeError("Production wardrobe has an invalid weight-transfer region")
        indices = set(range(start, start + count))
        if covered.intersection(indices):
            raise RuntimeError("Production wardrobe weight-transfer regions overlap")
        covered.update(indices)
        region_maximum = max(transfer_distances[start : start + count])
        if region_maximum > threshold:
            raise RuntimeError(
                f"Production wardrobe region '{region['id']}' transfer distance "
                f"{region_maximum:.6f}m exceeds {threshold:.6f}m"
            )
        region_reports.append(
            {
                "id": region["id"],
                "startVertex": start,
                "vertexCount": count,
                "maximumTransferDistanceMeters": region_maximum,
                "allowedMaximumDistanceMeters": threshold,
            }
        )
    if covered != set(range(len(transfer_distances))):
        raise RuntimeError("Production wardrobe weight-transfer regions do not cover every vertex")
    modifier = mesh.modifiers.new(name="production-rigify-skin", type="ARMATURE")
    modifier.object = armature
    modifier.use_deform_preserve_volume = True
    mesh.parent = armature
    mesh.matrix_parent_inverse = armature.matrix_world.inverted()
    return mesh, {
        "assetId": asset["id"],
        "binding": component["binding"],
        "maximumTransferDistanceMeters": maximum_distance,
        "minimumVertexInfluences": minimum_influences,
        "regions": region_reports,
    }


def assemble(definition, body, armature, body_mesh, profile, geometry_probe):
    binding_path = os.path.abspath(definition["productionCharacterBindingPath"])
    binding = load_json(binding_path)
    validate_binding(binding_path, definition, binding, body, profile)
    materials = apply_material_bindings(binding_path, binding, body, body_mesh, geometry_probe)
    objects = []
    hair_report = None
    if binding.get("hair"):
        hair, hair_report = bind_hair(
            binding_path, binding["hair"], body, armature, profile, geometry_probe
        )
        objects.append(hair)
    wardrobe_report = []
    for component in binding.get("wardrobe", []):
        garment, report = bind_wardrobe(
            binding_path, component, body, body_mesh, armature, profile, geometry_probe
        )
        objects.append(garment)
        wardrobe_report.append(report)
    armatures = {item for item in [armature] + [obj.parent for obj in objects] if item and item.type == "ARMATURE"}
    if armatures != {armature}:
        raise RuntimeError("Production-character assembly created duplicate animated armatures")
    return objects, {
        "entityId": definition["id"],
        "bindingId": binding["id"],
        "armature": armature.name,
        "armatureCount": 1,
        "body": body["id"],
        "materials": materials,
        "hair": hair_report,
        "wardrobe": wardrobe_report,
        "objectNames": [body_mesh.name] + [item.name for item in objects],
    }
