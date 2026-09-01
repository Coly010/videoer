import json
import os
import sys
import traceback

import bmesh
import bpy


def arguments():
    values = sys.argv[sys.argv.index("--") + 1 :]
    if len(values) != 3:
        raise SystemExit("usage: blender --background --python retopologize_human_body.py -- input.json output.json target-faces")
    return os.path.abspath(values[0]), os.path.abspath(values[1]), int(values[2])


def to_blender(position):
    return (position[0], -position[2], position[1])


def to_canonical(position):
    return [position[0], position[2], -position[1]]


def body_indices(asset):
    anatomy = asset.get("metadata", {}).get("anatomy", {})
    materials = set(anatomy.get("bodyMaterialIds", ["skin"]))
    result = []
    for group in asset.get("materialGroups", []):
        if group["materialId"] in materials:
            result.extend(asset["indices"][group["start"] : group["start"] + group["count"]])
    if not result:
        result = list(asset["indices"])
    return result


def create_body(asset):
    source_indices = body_indices(asset)
    used = sorted(set(source_indices))
    remap = {source: target for target, source in enumerate(used)}
    vertices = [to_blender(asset["positions"][source]) for source in used]
    faces = [
        tuple(remap[source_indices[index + offset]] for offset in range(3))
        for index in range(0, len(source_indices), 3)
    ]
    mesh = bpy.data.meshes.new("production-human-source")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    body = bpy.data.objects.new("production-human-source", mesh)
    bpy.context.collection.objects.link(body)
    return body


def topology_diagnostic(mesh, label):
    diagnostic = bmesh.new()
    diagnostic.from_mesh(mesh)
    diagnostic.verts.ensure_lookup_table()
    diagnostic.edges.ensure_lookup_table()
    diagnostic.faces.ensure_lookup_table()
    remaining = set(diagnostic.faces)
    components = 0
    while remaining:
        components += 1
        stack = [remaining.pop()]
        while stack:
            face = stack.pop()
            for edge in face.edges:
                for adjacent in edge.link_faces:
                    if adjacent in remaining:
                        remaining.remove(adjacent)
                        stack.append(adjacent)
    result = {
        "vertices": len(diagnostic.verts),
        "faces": len(diagnostic.faces),
        "components": components,
        "non_manifold_edges": sum(1 for edge in diagnostic.edges if not edge.is_manifold),
        "non_manifold_vertices": sum(1 for vertex in diagnostic.verts if not vertex.is_manifold),
        "degenerate_faces": sum(1 for face in diagnostic.faces if face.calc_area() <= 1e-12),
        "orientation_conflicts": sum(
            1
            for edge in diagnostic.edges
            if len(edge.link_loops) == 2
            and edge.link_loops[0].vert == edge.link_loops[1].vert
        ),
        "signed_volume": diagnostic.calc_volume(signed=True),
    }
    diagnostic.free()
    print(label, result)
    return result


def retopologize(body, target_faces):
    diagnostic = bmesh.new()
    diagnostic.from_mesh(body.data)
    bmesh.ops.remove_doubles(diagnostic, verts=list(diagnostic.verts), dist=1e-7)
    bmesh.ops.recalc_face_normals(diagnostic, faces=list(diagnostic.faces))
    diagnostic.to_mesh(body.data)
    body.data.update()
    diagnostic.free()
    topology_diagnostic(body.data, "INPUT_TOPOLOGY")
    print("MESH_VALIDATE_CHANGED", body.data.validate(verbose=True, clean_customdata=True))
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    body.data.remesh_voxel_size = 0.012
    body.data.remesh_voxel_adaptivity = 0.0
    voxel_result = bpy.ops.object.voxel_remesh()
    if "FINISHED" not in voxel_result:
        raise RuntimeError(f"Voxel remesh failed: {voxel_result}")
    voxel_editable = bmesh.new()
    voxel_editable.from_mesh(body.data)
    bmesh.ops.recalc_face_normals(voxel_editable, faces=list(voxel_editable.faces))
    voxel_editable.to_mesh(body.data)
    voxel_editable.free()
    body.data.update()
    topology_diagnostic(body.data, "VOXEL_TOPOLOGY")
    result = bpy.ops.object.quadriflow_remesh(
        use_mesh_symmetry=False,
        use_preserve_sharp=False,
        use_preserve_boundary=False,
        preserve_attributes=False,
        smooth_normals=True,
        mode="FACES",
        target_faces=target_faces,
        seed=0,
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"QuadriFlow failed: {result}")
    editable = bmesh.new()
    editable.from_mesh(body.data)
    bmesh.ops.triangulate(editable, faces=list(editable.faces), quad_method="BEAUTY", ngon_method="BEAUTY")
    editable.to_mesh(body.data)
    editable.free()
    body.data.update()
    for polygon in body.data.polygons:
        polygon.use_smooth = True


def export_body(body, input_path, target_faces, output_path):
    body.data.calc_loop_triangles()
    output = {
        "schemaVersion": 1,
        "source": input_path,
        "method": "blender-quadriflow-seed-0",
        "targetFaces": target_faces,
        "positions": [to_canonical(vertex.co) for vertex in body.data.vertices],
        "normals": [to_canonical(vertex.normal) for vertex in body.data.vertices],
        "indices": [vertex for triangle in body.data.loop_triangles for vertex in triangle.vertices],
    }
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf8") as handle:
        json.dump(output, handle, indent=2)
        handle.write("\n")


def main():
    input_path, output_path, target_faces = arguments()
    with open(input_path, "r", encoding="utf8") as handle:
        asset = json.load(handle)
    body = create_body(asset)
    retopologize(body, target_faces)
    export_body(body, input_path, target_faces, output_path)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(1)
