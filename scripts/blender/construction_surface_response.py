"""Blender construction-domain surface-history responses.

This module deliberately contains no scene loading or Videoer field decoding.  It
only turns already-validated scalar sockets and a typed construction response into
geometry-aware shader signals.  Callers remain responsible for applying the
ordinary history colour/roughness response after using the returned sockets.
"""

import math
import zlib


_SUPPORTED_KINDS = {
    "natural-joint",
    "polymeric-joint",
    "paving-border",
    "exposed-substrate",
}


def _fail(message):
    raise RuntimeError(f"Construction surface response: {message}")


def _mapping(value, label):
    if not isinstance(value, dict):
        _fail(f"{label} must be an object")
    return value


def _number(value, label, minimum=None, maximum=None, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        _fail(f"{label} must be a finite number")
    value = float(value)
    if positive and value <= 0:
        _fail(f"{label} must be positive")
    if minimum is not None and value < minimum:
        _fail(f"{label} must be at least {minimum}")
    if maximum is not None and value > maximum:
        _fail(f"{label} must be at most {maximum}")
    return value


def _socket(value, label):
    if value is None or not hasattr(value, "node"):
        _fail(f"{label} must be a Blender output socket")
    return value


def _set_input(links, target, value):
    if hasattr(value, "node"):
        links.new(value, target)
    else:
        target.default_value = value


def _math(nodes, links, names, name, operation, left, right=None):
    node = nodes.new("ShaderNodeMath")
    node.name = name
    node.label = name
    node.operation = operation
    _set_input(links, node.inputs[0], left)
    if right is not None:
        _set_input(links, node.inputs[1], right)
    names.append(name)
    return node.outputs[0]


def _clamp01(nodes, links, names, name, value):
    node = nodes.new("ShaderNodeClamp")
    node.name = name
    node.label = name
    node.inputs["Min"].default_value = 0.0
    node.inputs["Max"].default_value = 1.0
    links.new(value, node.inputs["Value"])
    names.append(name)
    return node.outputs["Result"]


def _smooth_range(nodes, links, names, name, value, onset, saturation):
    if saturation <= onset:
        _fail(f"{name} saturation must exceed onset")
    node = nodes.new("ShaderNodeMapRange")
    node.name = name
    node.label = name
    node.clamp = True
    node.interpolation_type = "SMOOTHERSTEP"
    links.new(value, node.inputs["Value"])
    node.inputs["From Min"].default_value = onset
    node.inputs["From Max"].default_value = saturation
    node.inputs["To Min"].default_value = 0.0
    node.inputs["To Max"].default_value = 1.0
    names.append(name)
    return node.outputs["Result"]


def _mix(nodes, links, names, name, low, high, factor):
    span = _math(nodes, links, names, f"{name}-span", "SUBTRACT", high, low)
    weighted = _math(nodes, links, names, f"{name}-weighted", "MULTIPLY", span, factor)
    return _math(nodes, links, names, name, "ADD", low, weighted)


def _maximum(nodes, links, names, name, sockets):
    if not sockets:
        _fail(f"{name} requires at least one signal")
    result = sockets[0]
    for index, candidate in enumerate(sockets[1:], start=1):
        result = _math(
            nodes,
            links,
            names,
            f"{name}-{index}",
            "MAXIMUM",
            result,
            candidate,
        )
    return result


def _physical_noise(nodes, links, names, name, scale_meters, seed):
    scale_meters = _number(scale_meters, f"{name} scaleMeters", positive=True)
    if isinstance(seed, bool) or not isinstance(seed, int):
        _fail(f"{name} seed must be an integer")
    coordinates = nodes.new("ShaderNodeTexCoord")
    coordinates.name = f"{name}-object-metres"
    coordinates.label = f"{name}-object-metres"
    noise = nodes.new("ShaderNodeTexNoise")
    noise.name = name
    noise.label = name
    noise.noise_dimensions = "4D"
    noise.inputs["Scale"].default_value = 1.0 / scale_meters
    noise.inputs["Detail"].default_value = 2.0
    noise.inputs["Roughness"].default_value = 0.5
    noise.inputs["W"].default_value = float(seed % 1_000_003) / 1_000_003.0
    links.new(coordinates.outputs["Object"], noise.inputs["Vector"])
    names.extend([coordinates.name, name])
    return noise.outputs["Fac"]


def _object_space_normal(nodes, links, names, name):
    geometry = nodes.new("ShaderNodeNewGeometry")
    geometry.name = f"{name}-geometry"
    transform = nodes.new("ShaderNodeVectorTransform")
    transform.name = f"{name}-world-to-object"
    transform.vector_type = "NORMAL"
    transform.convert_from = "WORLD"
    transform.convert_to = "OBJECT"
    normalize = nodes.new("ShaderNodeVectorMath")
    normalize.name = f"{name}-normalize"
    normalize.operation = "NORMALIZE"
    links.new(geometry.outputs["Normal"], transform.inputs["Vector"])
    links.new(transform.outputs["Vector"], normalize.inputs[0])
    names.extend([geometry.name, transform.name, normalize.name])
    return normalize.outputs["Vector"]


def _upward_top_face_mask(nodes, links, names, name):
    separate = nodes.new("ShaderNodeSeparateXYZ")
    separate.name = f"{name}-components"
    links.new(_object_space_normal(nodes, links, names, name), separate.inputs["Vector"])
    names.append(separate.name)
    return _clamp01(nodes, links, names, f"{name}-mask", separate.outputs["Z"])


def _chain_bump(nodes, links, names, principled, name, height, strength, distance):
    normal_input = principled.inputs.get("Normal")
    if normal_input is None:
        _fail("Principled BSDF has no Normal input")
    existing = normal_input.links[0].from_socket if normal_input.is_linked else None
    if normal_input.is_linked:
        links.remove(normal_input.links[0])
    bump = nodes.new("ShaderNodeBump")
    bump.name = name
    bump.label = name
    _set_input(links, bump.inputs["Height"], height)
    _set_input(links, bump.inputs["Strength"], strength)
    bump.inputs["Distance"].default_value = _number(distance, f"{name} distance", minimum=0)
    if existing is not None:
        links.new(existing, bump.inputs["Normal"])
    links.new(bump.outputs["Normal"], normal_input)
    names.append(name)
    return existing is not None


def _field_cell_size(definition, explicit):
    if explicit is not None:
        return _number(explicit, "surface-history field cell size", positive=True)
    grid = definition.get("surfaceHistoryGrid")
    if isinstance(grid, dict) and "cellSizeMeters" in grid:
        return _number(
            grid["cellSizeMeters"], "surfaceHistoryGrid.cellSizeMeters", positive=True
        )
    if "surfaceHistoryCellSizeMeters" in definition:
        return _number(
            definition["surfaceHistoryCellSizeMeters"],
            "surfaceHistoryCellSizeMeters",
            positive=True,
        )
    _fail("joint displacement requires the source field cell size")


def _material_output(nodes):
    candidates = [node for node in nodes if node.bl_idname == "ShaderNodeOutputMaterial"]
    active = [node for node in candidates if getattr(node, "is_active_output", False)]
    if len(active) == 1:
        return active[0]
    if len(candidates) == 1:
        return candidates[0]
    _fail("material must have exactly one active Material Output")


def _chain_signed_displacement(nodes, links, names, name, signed_height):
    output = _material_output(nodes)
    displacement_input = output.inputs.get("Displacement")
    if displacement_input is None:
        _fail("Material Output has no Displacement input")
    existing = displacement_input.links[0].from_socket if displacement_input.is_linked else None
    if displacement_input.is_linked:
        links.remove(displacement_input.links[0])
    displacement = nodes.new("ShaderNodeDisplacement")
    displacement.name = name
    displacement.label = name
    displacement.inputs["Midlevel"].default_value = 0.0
    displacement.inputs["Scale"].default_value = 1.0
    links.new(signed_height, displacement.inputs["Height"])
    result = displacement.outputs["Displacement"]
    names.append(name)
    if existing is not None:
        result = _math(
            nodes,
            links,
            names,
            f"{name}-preserve-existing",
            "ADD",
            existing,
            result,
        )
    links.new(result, displacement_input)
    return existing is not None


def _target_render_meshes(material, material_id, maximum_segment_meters, receiver_object=None):
    """Subdivide only polygons assigned to ``material`` for render displacement."""

    try:
        import bmesh
        import bpy
    except ImportError as error:
        _fail(f"render-mesh displacement requires Blender bmesh: {error}")
    objects = [receiver_object] if receiver_object is not None else [
        candidate
        for candidate in bpy.data.objects
        if getattr(candidate, "type", None) == "MESH"
        and any(slot.material == material for slot in candidate.material_slots)
    ]
    objects = [candidate for candidate in objects if candidate is not None]
    if not objects:
        _fail(f"material '{material_id}' has no receiver mesh user")
    evidence = []
    for receiver in objects:
        if getattr(receiver, "type", None) != "MESH":
            _fail(f"receiver object '{receiver.name}' is not a mesh")
        target_slots = {
            index
            for index, slot in enumerate(receiver.material_slots)
            if slot.material == material
        }
        if not target_slots:
            _fail(f"receiver object '{receiver.name}' does not bind material '{material_id}'")
        mesh = receiver.data
        if mesh.users > 1:
            mesh = mesh.copy()
            receiver.data = mesh
        bm = bmesh.new()
        try:
            bm.from_mesh(mesh)
            target_faces = [face for face in bm.faces if face.material_index in target_slots]
            if not target_faces:
                _fail(f"receiver object '{receiver.name}' has no target polygons for '{material_id}'")
            target_face_set = set(target_faces)
            target_edges = {edge for face in target_faces for edge in face.edges}
            shared = [
                edge
                for edge in target_edges
                if any(face not in target_face_set for face in edge.link_faces)
            ]
            if shared:
                _fail(
                    f"receiver object '{receiver.name}' has target edges shared with non-target faces"
                )
            maximum_before = max((edge.calc_length() for edge in target_edges), default=0.0)
            cuts = max(0, int(math.ceil(maximum_before / maximum_segment_meters)) - 1)
            vertices_before = len(bm.verts)
            faces_before = len(bm.faces)
            if cuts:
                bmesh.ops.subdivide_edges(
                    bm,
                    edges=list(target_edges),
                    cuts=cuts,
                    use_grid_fill=True,
                )
            resulting_faces = [face for face in bm.faces if face.material_index in target_slots]
            resulting_edges = {edge for face in resulting_faces for edge in face.edges}
            maximum_after = max((edge.calc_length() for edge in resulting_edges), default=0.0)
            tolerance = max(1e-9, maximum_segment_meters * 1e-9)
            if maximum_after > maximum_segment_meters + tolerance:
                _fail(
                    f"receiver object '{receiver.name}' target tessellation exceeds field cell size"
                )
            bm.to_mesh(mesh)
            mesh.update()
            evidence.append(
                {
                    "objectName": receiver.name,
                    "targetMaterialSlots": sorted(target_slots),
                    "targetPolygonCountBefore": len(target_faces),
                    "targetPolygonCountAfter": len(resulting_faces),
                    "vertexCountBefore": vertices_before,
                    "vertexCountAfter": len(bm.verts),
                    "faceCountBefore": faces_before,
                    "faceCountAfter": len(bm.faces),
                    "maximumTargetSegmentMetersBefore": maximum_before,
                    "maximumTargetSegmentMetersAfter": maximum_after,
                    "maximumAllowedSegmentMeters": maximum_segment_meters,
                    "subdivisionCuts": cuts,
                }
            )
        finally:
            bm.free()
    cycles = getattr(material, "cycles", None)
    if cycles is not None and hasattr(cycles, "displacement_method"):
        cycles.displacement_method = "BOTH"
    return evidence


def _joint_metadata(definition, material_id):
    joints = _mapping(definition.get("joints"), "irregular-paving joints")
    if joints.get("materialId") != material_id:
        _fail(f"material '{material_id}' is not the authored continuous joint")
    return {
        "depthMeters": _number(
            joints.get("depthMeters"), "irregular-paving joints.depthMeters", positive=True
        ),
        "widthMeters": _number(
            joints.get("widthMeters"), "irregular-paving joints.widthMeters", positive=True
        ),
    }


def _substrate_metadata(definition, material_id):
    materials = _mapping(definition.get("materials"), "irregular-paving materials")
    if materials.get("substrateId") != material_id:
        _fail(f"material '{material_id}' is not the authored exposed substrate")
    joints = _mapping(definition.get("joints"), "irregular-paving joints")
    units = _mapping(definition.get("units"), "irregular-paving units")
    return {
        "jointDepthMeters": _number(
            joints.get("depthMeters"), "irregular-paving joints.depthMeters", positive=True
        ),
        "jointWidthMeters": _number(
            joints.get("widthMeters"), "irregular-paving joints.widthMeters", positive=True
        ),
        "unitHeightMeters": _number(
            units.get("heightMeters"), "irregular-paving units.heightMeters", positive=True
        ),
    }


def _border_metadata(definition, material_id):
    borders = definition.get("borders")
    if not isinstance(borders, list):
        _fail("irregular-paving borders must be an array")
    matches = [border for border in borders if isinstance(border, dict) and border.get("materialId") == material_id]
    if len(matches) != 1:
        _fail(f"material '{material_id}' must identify exactly one authored border")
    border = matches[0]
    boundary = _mapping(definition.get("boundary"), "irregular-paving boundary")
    if boundary.get("kind") != "rectangle":
        _fail("paving-border response requires a rectangular receiver boundary")
    minimum = boundary.get("minimum")
    maximum = boundary.get("maximum")
    if not isinstance(minimum, list) or len(minimum) != 2 or not isinstance(maximum, list) or len(maximum) != 2:
        _fail("irregular-paving rectangular boundary requires two-component minimum and maximum")
    side = border.get("side")
    if side not in ("minimum-x", "maximum-x", "minimum-z", "maximum-z"):
        _fail("authored border side is invalid")
    joints = _mapping(definition.get("joints"), "irregular-paving joints")
    return {
        "kind": border.get("kind"),
        "side": side,
        "widthMeters": _number(border.get("widthMeters"), "border widthMeters", positive=True),
        "riseMeters": _number(border.get("riseMeters"), "border riseMeters"),
        "jointDepthMeters": _number(
            joints.get("depthMeters"), "irregular-paving joints.depthMeters", positive=True
        ),
        "boundaryMinimum": [
            _number(minimum[0], "boundary minimum x"),
            _number(minimum[1], "boundary minimum z"),
        ],
        "boundaryMaximum": [
            _number(maximum[0], "boundary maximum x"),
            _number(maximum[1], "boundary maximum z"),
        ],
    }


def _border_coordinate(nodes, links, names, metadata):
    coordinates = nodes.new("ShaderNodeTexCoord")
    coordinates.name = "videoer-construction-border-object-coordinates"
    separate_position = nodes.new("ShaderNodeSeparateXYZ")
    separate_position.name = "videoer-construction-border-position"
    links.new(coordinates.outputs["Object"], separate_position.inputs["Vector"])
    names.extend([coordinates.name, separate_position.name])
    side = metadata["side"]
    width = metadata["widthMeters"]
    minimum = metadata["boundaryMinimum"]
    maximum = metadata["boundaryMaximum"]
    if side == "minimum-x":
        coordinate = separate_position.outputs["X"]
        outer = minimum[0] - width
        paving_sign = 1.0
    elif side == "maximum-x":
        coordinate = separate_position.outputs["X"]
        outer = maximum[0] + width
        paving_sign = -1.0
    elif side == "minimum-z":
        # Canonical +z maps to Blender -y.
        coordinate = separate_position.outputs["Y"]
        outer = -(minimum[1] - width)
        paving_sign = -1.0
    else:
        coordinate = separate_position.outputs["Y"]
        outer = -(maximum[1] + width)
        paving_sign = 1.0
    offset = _math(
        nodes,
        links,
        names,
        "videoer-construction-border-width-offset",
        "SUBTRACT",
        coordinate,
        outer,
    )
    normalized = _math(
        nodes,
        links,
        names,
        "videoer-construction-border-width-normalized",
        "DIVIDE",
        offset,
        width,
    )
    return _clamp01(
        nodes,
        links,
        names,
        "videoer-construction-border-width-clamp",
        normalized,
    ), paving_sign


def _border_face_mask(nodes, links, names, response, paving_sign, side):
    faces = response.get("historyFaces")
    if not isinstance(faces, list) or not faces or len(set(faces)) != len(faces):
        _fail("paving-border historyFaces must be a non-empty unique array")
    if any(face not in ("top", "paving-facing", "outer-facing") for face in faces):
        _fail("paving-border historyFaces contains an unsupported face")
    transition = _number(
        response.get("faceTransitionCosine"), "paving-border faceTransitionCosine", 0, 1
    )
    separate_normal = nodes.new("ShaderNodeSeparateXYZ")
    separate_normal.name = "videoer-construction-border-normal"
    links.new(
        _object_space_normal(
            nodes, links, names, "videoer-construction-border-object-normal"
        ),
        separate_normal.inputs["Vector"],
    )
    names.append(separate_normal.name)
    normal_component = (
        separate_normal.outputs["X"] if side.endswith("x") else separate_normal.outputs["Y"]
    )
    masks = []
    if "top" in faces:
        masks.append(
            _smooth_range(
                nodes,
                links,
                names,
                "videoer-construction-border-top-face",
                separate_normal.outputs["Z"],
                transition,
                1.0,
            )
        )
    signed_side = _math(
        nodes,
        links,
        names,
        "videoer-construction-border-paving-face-direction",
        "MULTIPLY",
        normal_component,
        paving_sign,
    )
    if "paving-facing" in faces:
        masks.append(
            _smooth_range(
                nodes,
                links,
                names,
                "videoer-construction-border-paving-face",
                signed_side,
                transition,
                1.0,
            )
        )
    if "outer-facing" in faces:
        outward = _math(
            nodes,
            links,
            names,
            "videoer-construction-border-outer-face-direction",
            "MULTIPLY",
            signed_side,
            -1.0,
        )
        masks.append(
            _smooth_range(
                nodes,
                links,
                names,
                "videoer-construction-border-outer-face",
                outward,
                transition,
                1.0,
            )
        )
    return _clamp01(
        nodes,
        links,
        names,
        "videoer-construction-border-history-face-mask",
        _maximum(nodes, links, names, "videoer-construction-border-face-union", masks),
    )


def apply_construction_surface_response(
    material,
    node_tree,
    principled,
    response,
    paving_definition,
    material_id,
    traffic_socket,
    throughflow_socket,
    retained_socket,
    loose_dirt_socket,
    persistent_dirt_socket,
    field_cell_size_meters=None,
    receiver_object=None,
):
    """Apply one typed construction response and return its report and output sockets.

    The five incoming sockets must carry normalized, receiver-space surface-history
    signals.  The returned ``signals`` mapping may gate them by construction domain;
    callers should use those sockets for subsequent optical colour/roughness work.
    """

    if material is None or node_tree is None or principled is None:
        _fail("material, node tree and Principled BSDF are required")
    if getattr(material, "node_tree", node_tree) is not node_tree:
        _fail("node tree does not belong to the supplied material")
    response = _mapping(response, "typed response")
    definition = _mapping(paving_definition, "irregular-paving definition metadata")
    if not isinstance(material_id, str) or not material_id:
        _fail("material id must be a non-empty string")
    kind = response.get("kind")
    if kind not in _SUPPORTED_KINDS:
        _fail(f"unsupported typed response kind '{kind}'")
    sockets = {
        "traffic": _socket(traffic_socket, "traffic socket"),
        "throughflow": _socket(throughflow_socket, "throughflow socket"),
        "retained": _socket(retained_socket, "retained socket"),
        "loose": _socket(loose_dirt_socket, "loose dirt socket"),
        "persistent": _socket(persistent_dirt_socket, "persistent dirt socket"),
    }
    nodes = node_tree.nodes
    links = node_tree.links
    node_names = []
    normal_chained = False
    geometry_report = {}
    transformed = []
    displacement_report = None

    if kind in ("natural-joint", "polymeric-joint"):
        if response.get("geometryBasis") != "authored-joint-recession":
            _fail(f"{kind} requires authored-joint-recession geometryBasis")
        if response.get("heightRepresentation") != "render-mesh-displacement-required":
            _fail(f"{kind} requires render-mesh-displacement-required heightRepresentation")
        geometry_report = _joint_metadata(definition, material_id)
        cell_size = _field_cell_size(definition, field_cell_size_meters)
        displacement_report = {
            "heightRepresentation": response["heightRepresentation"],
            "fieldCellSizeMeters": cell_size,
            "meshes": _target_render_meshes(
                material,
                material_id,
                cell_size,
                receiver_object=receiver_object,
            ),
        }

    if kind == "natural-joint":
        clogging = _mapping(response.get("clogging"), "natural-joint clogging")
        if clogging.get("driver") != "dirt-coverage":
            _fail("natural-joint clogging driver must be dirt-coverage")
        loose_weight = _number(clogging.get("looseWeight"), "clogging looseWeight", 0, 4)
        persistent_weight = _number(
            clogging.get("persistentWeight"), "clogging persistentWeight", 0, 4
        )
        total_weight = loose_weight + persistent_weight
        if total_weight <= 0:
            _fail("natural-joint clogging requires a positive dirt weight")
        weighted_loose = _math(
            nodes, links, node_names, "videoer-construction-natural-loose-weight", "MULTIPLY", sockets["loose"], loose_weight
        )
        weighted_persistent = _math(
            nodes, links, node_names, "videoer-construction-natural-persistent-weight", "MULTIPLY", sockets["persistent"], persistent_weight
        )
        coverage_sum = _math(
            nodes, links, node_names, "videoer-construction-natural-coverage-sum", "ADD", weighted_loose, weighted_persistent
        )
        coverage = _clamp01(
            nodes,
            links,
            node_names,
            "videoer-construction-natural-coverage",
            coverage_sum,
        )
        clog = _smooth_range(
            nodes,
            links,
            node_names,
            "videoer-construction-natural-clogging",
            coverage,
            _number(clogging.get("onsetCoverage"), "clogging onsetCoverage", 0, 1),
            _number(clogging.get("saturationCoverage"), "clogging saturationCoverage", 0, 1),
        )
        maximum_fill = _number(
            clogging.get("maximumFillFractionOfRecession"),
            "clogging maximumFillFractionOfRecession",
            0,
            1,
        )
        top_face = _upward_top_face_mask(
            nodes, links, node_names, "videoer-construction-natural-top-face"
        )
        clog = _math(
            nodes,
            links,
            node_names,
            "videoer-construction-natural-top-face-clogging",
            "MULTIPLY",
            clog,
            top_face,
        )
        normal = _mapping(response.get("normal"), "natural-joint normal")
        strength = _mix(
            nodes,
            links,
            node_names,
            "videoer-construction-natural-normal-strength",
            _number(normal.get("intactStrengthScale"), "normal intactStrengthScale", 0, 2),
            _number(normal.get("changedStrengthScale"), "normal changedStrengthScale", 0, 2),
            clog,
        )
        normal_chained = _chain_bump(
            nodes,
            links,
            node_names,
            principled,
            "videoer-construction-natural-joint-fill",
            clog,
            strength,
            geometry_report["depthMeters"] * maximum_fill,
        )
        fill_meters = _math(
            nodes,
            links,
            node_names,
            "videoer-construction-natural-fill-metres",
            "MULTIPLY",
            clog,
            geometry_report["depthMeters"] * maximum_fill,
        )
        displacement_report["preservedExistingDisplacement"] = _chain_signed_displacement(
            nodes,
            links,
            node_names,
            "videoer-construction-natural-joint-displacement",
            fill_meters,
        )
        displacement_report["signedMaximumDisplacementMeters"] = (
            geometry_report["depthMeters"] * maximum_fill
        )
        sockets["construction"] = clog

    elif kind == "polymeric-joint":
        failure = _mapping(response.get("coherentFailure"), "polymeric-joint coherentFailure")
        if failure.get("driver") != "traffic-and-throughflow":
            _fail("polymeric-joint failure driver must be traffic-and-throughflow")
        traffic_weight = _number(failure.get("trafficWeight"), "failure trafficWeight", 0, 4)
        throughflow_weight = _number(
            failure.get("throughflowWeight"), "failure throughflowWeight", 0, 4
        )
        total_weight = traffic_weight + throughflow_weight
        if total_weight <= 0:
            _fail("polymeric-joint failure requires a positive causal weight")
        traffic = _math(
            nodes, links, node_names, "videoer-construction-polymeric-traffic", "MULTIPLY", sockets["traffic"], traffic_weight
        )
        throughflow = _math(
            nodes, links, node_names, "videoer-construction-polymeric-throughflow", "MULTIPLY", sockets["throughflow"], throughflow_weight
        )
        causal_sum = _math(
            nodes, links, node_names, "videoer-construction-polymeric-causal-sum", "ADD", traffic, throughflow
        )
        causal = _math(
            nodes, links, node_names, "videoer-construction-polymeric-causal", "DIVIDE", causal_sum, total_weight
        )
        coherence_scale = _number(
            failure.get("coherenceScaleMeters"), "failure coherenceScaleMeters", positive=True
        )
        noise = _physical_noise(
            nodes,
            links,
            node_names,
            "videoer-construction-polymeric-coherence",
            coherence_scale,
            failure.get("seed"),
        )
        coherent_causal = _math(
            nodes, links, node_names, "videoer-construction-polymeric-coherent-causal", "MULTIPLY", causal, noise
        )
        failure_mask = _smooth_range(
            nodes,
            links,
            node_names,
            "videoer-construction-polymeric-failure",
            coherent_causal,
            _number(failure.get("onset"), "failure onset", 0, 1),
            _number(failure.get("saturation"), "failure saturation", 0, 1),
        )
        top_face = _upward_top_face_mask(
            nodes, links, node_names, "videoer-construction-polymeric-top-face"
        )
        failure_mask = _math(
            nodes,
            links,
            node_names,
            "videoer-construction-polymeric-top-face-failure",
            "MULTIPLY",
            failure_mask,
            top_face,
        )
        intact_height = _math(
            nodes, links, node_names, "videoer-construction-polymeric-intact-height", "SUBTRACT", 1.0, failure_mask
        )
        normal = _mapping(response.get("normal"), "polymeric-joint normal")
        strength = _mix(
            nodes,
            links,
            node_names,
            "videoer-construction-polymeric-normal-strength",
            _number(normal.get("intactStrengthScale"), "normal intactStrengthScale", 0, 2),
            _number(normal.get("changedStrengthScale"), "normal changedStrengthScale", 0, 2),
            failure_mask,
        )
        recession = _number(
            failure.get("maximumAdditionalRecessionFraction"),
            "failure maximumAdditionalRecessionFraction",
            0,
            1,
        )
        normal_chained = _chain_bump(
            nodes,
            links,
            node_names,
            principled,
            "videoer-construction-polymeric-joint-failure",
            intact_height,
            strength,
            geometry_report["depthMeters"] * recession,
        )
        recession_meters = _math(
            nodes,
            links,
            node_names,
            "videoer-construction-polymeric-recession-metres",
            "MULTIPLY",
            failure_mask,
            -geometry_report["depthMeters"] * recession,
        )
        displacement_report["preservedExistingDisplacement"] = _chain_signed_displacement(
            nodes,
            links,
            node_names,
            "videoer-construction-polymeric-joint-displacement",
            recession_meters,
        )
        displacement_report["signedMaximumDisplacementMeters"] = (
            -geometry_report["depthMeters"] * recession
        )
        for dirt_name in ("loose", "persistent"):
            sockets[dirt_name] = _math(
                nodes,
                links,
                node_names,
                f"videoer-construction-polymeric-{dirt_name}-failure-gate",
                "MULTIPLY",
                sockets[dirt_name],
                failure_mask,
            )
            transformed.append(dirt_name)
        sockets["construction"] = failure_mask

    elif kind == "exposed-substrate":
        if response.get("activation") != "active-history-cells-only":
            _fail("exposed-substrate activation must be active-history-cells-only")
        if response.get("heightRepresentation") != "none-no-calibrated-height":
            _fail("exposed-substrate requires none-no-calibrated-height heightRepresentation")
        geometry_report = _substrate_metadata(definition, material_id)
        activity = _clamp01(
            nodes,
            links,
            node_names,
            "videoer-construction-substrate-activity",
            _maximum(
                nodes,
                links,
                node_names,
                "videoer-construction-substrate-active-history",
                list(sockets.values()),
            ),
        )
        seed = int(definition.get("seed", 0)) ^ zlib.crc32(material_id.encode("utf8"))
        scale = max(
            geometry_report["jointWidthMeters"],
            geometry_report["jointDepthMeters"],
        )
        noise = _physical_noise(
            nodes,
            links,
            node_names,
            "videoer-construction-substrate-aggregate",
            scale,
            seed,
        )
        active_noise = _math(
            nodes, links, node_names, "videoer-construction-substrate-active-normal", "MULTIPLY", noise, activity
        )
        normal = _mapping(response.get("normal"), "exposed-substrate normal")
        normal_chained = _chain_bump(
            nodes,
            links,
            node_names,
            principled,
            "videoer-construction-exposed-substrate",
            active_noise,
            _number(normal.get("strengthScale"), "normal strengthScale", 0, 2),
            min(geometry_report["jointDepthMeters"], geometry_report["unitHeightMeters"]),
        )
        deposition_scale = _number(
            response.get("dirtDepositionScale"), "exposed-substrate dirtDepositionScale", 0, 2
        )
        for dirt_name in ("loose", "persistent"):
            deposited = _math(
                nodes,
                links,
                node_names,
                f"videoer-construction-substrate-{dirt_name}-deposition",
                "MULTIPLY",
                sockets[dirt_name],
                deposition_scale,
            )
            sockets[dirt_name] = _clamp01(
                nodes,
                links,
                node_names,
                f"videoer-construction-substrate-{dirt_name}-active",
                _math(
                    nodes,
                    links,
                    node_names,
                    f"videoer-construction-substrate-{dirt_name}-gate",
                    "MULTIPLY",
                    deposited,
                    activity,
                ),
            )
            transformed.append(dirt_name)
        sockets["construction"] = activity
        displacement_report = {
            "heightRepresentation": "none-no-calibrated-height",
            "meshes": [],
        }

    else:
        if response.get("geometryBasis") != "authored-border-profile":
            _fail("paving-border requires authored-border-profile geometryBasis")
        if response.get("faceMaskFormula") != "smoothstep-minimum-alignment-cosine":
            _fail("paving-border requires smoothstep-minimum-alignment-cosine faceMaskFormula")
        geometry_report = _border_metadata(definition, material_id)
        width_coordinate, paving_sign = _border_coordinate(
            nodes, links, node_names, geometry_report
        )
        face_mask = _border_face_mask(
            nodes,
            links,
            node_names,
            response,
            paving_sign,
            geometry_report["side"],
        )
        for signal_name in ("traffic", "throughflow", "retained", "loose", "persistent"):
            sockets[signal_name] = _math(
                nodes,
                links,
                node_names,
                f"videoer-construction-border-{signal_name}-face-gate",
                "MULTIPLY",
                sockets[signal_name],
                face_mask,
            )
            transformed.append(signal_name)
        gutter = response.get("gutterZones")
        zone_mask = face_mask
        if gutter is not None:
            gutter = _mapping(gutter, "paving-border gutterZones")
            if geometry_report.get("kind") != "gutter":
                _fail("gutterZones require an authored gutter border")
            if gutter.get("coreDriver") != "throughflow-times-clean-surface":
                _fail("gutter coreDriver must be throughflow-times-clean-surface")
            if gutter.get("marginDriver") != "retained-water-times-dirt-coverage":
                _fail("gutter marginDriver must be retained-water-times-dirt-coverage")
            core_width = _number(gutter.get("coreWidthFraction"), "gutter coreWidthFraction", 0, 1)
            transition = _number(
                gutter.get("transitionWidthFraction"), "gutter transitionWidthFraction", 0, 0.5
            )
            if core_width <= 0 or core_width + 2 * transition > 1:
                _fail("gutter core and transition margins do not fit the authored width")
            centered = _math(
                nodes, links, node_names, "videoer-construction-gutter-centered-width", "SUBTRACT", width_coordinate, 0.5
            )
            distance = _math(
                nodes, links, node_names, "videoer-construction-gutter-width-distance", "ABSOLUTE", centered
            )
            core_inverse = _smooth_range(
                nodes,
                links,
                node_names,
                "videoer-construction-gutter-core-transition",
                distance,
                core_width * 0.5,
                core_width * 0.5 + transition,
            )
            core = _math(
                nodes, links, node_names, "videoer-construction-gutter-core", "SUBTRACT", 1.0, core_inverse
            )
            core = _math(
                nodes, links, node_names, "videoer-construction-gutter-core-face", "MULTIPLY", core, face_mask
            )
            margin = _math(
                nodes, links, node_names, "videoer-construction-gutter-margin", "SUBTRACT", face_mask, core
            )
            cleaning = _number(
                gutter.get("coreThroughflowCleaning"), "gutter coreThroughflowCleaning", 0, 1
            )
            deposition = _number(
                gutter.get("marginRetainedDeposition"), "gutter marginRetainedDeposition", 0, 2
            )
            dirt_coverage = _maximum(
                nodes,
                links,
                node_names,
                "videoer-construction-gutter-dirt-coverage",
                [sockets["loose"], sockets["persistent"]],
            )
            clean_surface = _math(
                nodes,
                links,
                node_names,
                "videoer-construction-gutter-clean-surface",
                "SUBTRACT",
                1.0,
                dirt_coverage,
            )
            core_throughflow = _math(
                nodes, links, node_names, "videoer-construction-gutter-core-throughflow", "MULTIPLY", sockets["throughflow"], core
            )
            cleaning_driver = _math(
                nodes, links, node_names, "videoer-construction-gutter-cleaning-driver", "MULTIPLY", core_throughflow, clean_surface
            )
            cleaning_amount = _math(
                nodes, links, node_names, "videoer-construction-gutter-cleaning-amount", "MULTIPLY", cleaning_driver, cleaning
            )
            dirt_gate = _math(
                nodes, links, node_names, "videoer-construction-gutter-dirt-retention", "SUBTRACT", 1.0, cleaning_amount
            )
            retained_margin = _math(
                nodes, links, node_names, "videoer-construction-gutter-retained-margin-driver", "MULTIPLY", sockets["retained"], margin
            )
            deposition_driver = _math(
                nodes, links, node_names, "videoer-construction-gutter-deposition-driver", "MULTIPLY", retained_margin, dirt_coverage
            )
            deposition_amount = _math(
                nodes, links, node_names, "videoer-construction-gutter-deposition-amount", "MULTIPLY", deposition_driver, deposition
            )
            dirt_gain = _math(
                nodes, links, node_names, "videoer-construction-gutter-dirt-gain", "ADD", 1.0, deposition_amount
            )
            for dirt_name in ("loose", "persistent"):
                retained_dirt = _math(
                    nodes,
                    links,
                    node_names,
                    f"videoer-construction-gutter-{dirt_name}-cleaned",
                    "MULTIPLY",
                    sockets[dirt_name],
                    dirt_gate,
                )
                sockets[dirt_name] = _clamp01(
                    nodes,
                    links,
                    node_names,
                    f"videoer-construction-gutter-{dirt_name}-margin-deposition",
                    _math(
                        nodes,
                        links,
                        node_names,
                        f"videoer-construction-gutter-{dirt_name}-gain",
                        "MULTIPLY",
                        retained_dirt,
                        dirt_gain,
                    ),
                )
            sockets["throughflow"] = _math(
                nodes, links, node_names, "videoer-construction-gutter-throughflow-core", "MULTIPLY", sockets["throughflow"], core
            )
            sockets["retained"] = _math(
                nodes, links, node_names, "videoer-construction-gutter-retained-margin", "MULTIPLY", sockets["retained"], margin
            )
            zone_mask = _maximum(
                nodes,
                links,
                node_names,
                "videoer-construction-gutter-zone-response",
                [sockets["throughflow"], sockets["retained"], sockets["loose"], sockets["persistent"]],
            )
        bump_distance = min(
            geometry_report["widthMeters"],
            geometry_report["jointDepthMeters"],
            abs(geometry_report["riseMeters"]) or geometry_report["widthMeters"],
        )
        normal_chained = _chain_bump(
            nodes,
            links,
            node_names,
            principled,
            "videoer-construction-paving-border-deposition",
            zone_mask,
            1.0,
            bump_distance,
        )
        sockets["construction"] = face_mask
        displacement_report = {
            "heightRepresentation": "authored-border-profile-signal-gating-only",
            "meshes": [],
        }

    return {
        "report": {
            "materialId": material_id,
            "responseKind": kind,
            "geometry": geometry_report,
            "normalInputChained": normal_chained,
            "transformedSignals": sorted(set(transformed)),
            "nodeNames": node_names,
            "physicalScalePolicy": "authored-irregular-paving-metres",
            "displacement": displacement_report,
        },
        "signals": sockets,
    }


__all__ = ["apply_construction_surface_response"]
