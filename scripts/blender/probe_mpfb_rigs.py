"""Headless, evidence-producing audit of MPFB's MakeHuman rigs.

This does not make MPFB or Rigify part of Videoer's domain model. It proves
that a pinned MPFB installation can reconstruct the exact hm08 base, attach
its authored deform rig, and generate the Rigify-with-toes control rig before
we commit to an adapter.
"""

import bpy
import hashlib
import importlib
import json
import os
import sys


def arguments():
    if "--" not in sys.argv:
        raise RuntimeError("Expected an output directory after --")
    values = sys.argv[sys.argv.index("--") + 1 :]
    if len(values) != 1:
        raise RuntimeError("Usage: blender --background --python probe_mpfb_rigs.py -- output")
    return os.path.abspath(values[0])


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def enable_addons():
    if bpy.ops.preferences.addon_enable(module="rigify") != {"FINISHED"}:
        raise RuntimeError("Blender's bundled Rigify addon could not be enabled")
    mpfb_module = next(
        (name for name in bpy.context.preferences.addons.keys() if name.endswith(".mpfb")),
        None,
    )
    if mpfb_module is None:
        # Factory startup suppresses enabled user extensions. The installed
        # extension still has a stable Blender module identifier.
        mpfb_module = "bl_ext.user_default.mpfb"
        if bpy.ops.preferences.addon_enable(module=mpfb_module) != {"FINISHED"}:
            raise RuntimeError(
                "MPFB is not installed. Run scripts/install-mpfb-extension.sh first."
            )
    return mpfb_module


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def bone_snapshot(armature):
    return {
        bone.name: {
            "parent": bone.parent.name if bone.parent else None,
            "head": [round(value, 9) for value in bone.head_local],
            "tail": [round(value, 9) for value in bone.tail_local],
            "roll": round(bone.matrix_local.to_euler("XYZ").y, 9),
            "deform": bone.use_deform,
        }
        for bone in armature.data.bones
    }


def weight_snapshot(mesh):
    weighted_vertices = 0
    influences = []
    for vertex in mesh.data.vertices:
        count = sum(1 for group in vertex.groups if group.weight > 0)
        if count:
            weighted_vertices += 1
            influences.append(count)
    return {
        "vertexGroups": len(mesh.vertex_groups),
        "weightedVertices": weighted_vertices,
        "maximumInfluences": max(influences, default=0),
        "meanInfluences": sum(influences) / len(influences) if influences else 0,
    }


def file_evidence(path):
    return {
        "path": path,
        "bytes": os.path.getsize(path),
        "sha256": sha256(path),
    }


def main():
    output = arguments()
    os.makedirs(output, exist_ok=True)
    mpfb_module_name = enable_addons()
    mpfb = importlib.import_module(mpfb_module_name)
    services = importlib.import_module(f"{mpfb_module_name}.services")
    HumanService = services.HumanService
    RigService = services.RigService
    LocationService = services.LocationService

    rigs_root = LocationService.get_mpfb_data("rigs")
    base_path = os.path.join(LocationService.get_mpfb_data("3dobjs"), "base.obj")
    sources = {
        "base": file_evidence(base_path),
        "defaultRig": file_evidence(os.path.join(rigs_root, "standard", "rig.default.json")),
        "defaultWeights": file_evidence(
            os.path.join(rigs_root, "standard", "weights.default.json")
        ),
        "rigifyHumanToes": file_evidence(
            os.path.join(rigs_root, "rigify", "rig.human_toes.json")
        ),
        "rigifyHumanToesWeights": file_evidence(
            os.path.join(rigs_root, "rigify", "weights.human_toes.json")
        ),
    }

    clear_scene()
    default_mesh = HumanService.create_human(
        mask_helpers=False,
        detailed_helpers=True,
        extra_vertex_groups=True,
        feet_on_ground=True,
        scale=0.1,
    )
    default_rig = HumanService.add_builtin_rig(default_mesh, "default", import_weights=True)
    if default_rig is None:
        raise RuntimeError("MPFB did not create its default rig")
    default_bones = bone_snapshot(default_rig)
    default_result = {
        "identifiedAs": RigService.identify_rig(default_rig),
        "bones": len(default_bones),
        "deformBones": sum(1 for bone in default_bones.values() if bone["deform"]),
        "individualToeBones": sorted(name for name in default_bones if name.startswith("toe")),
        "weights": weight_snapshot(default_mesh),
        "selectedBones": {
            name: default_bones[name]
            for name in [
                "upperleg01.L",
                "upperleg02.L",
                "lowerleg01.L",
                "lowerleg02.L",
                "foot.L",
                "toe1-1.L",
                "toe2-1.L",
                "wrist.L",
                "finger2-1.L",
            ]
        },
    }

    clear_scene()
    rigify_mesh = HumanService.create_human(
        mask_helpers=False,
        detailed_helpers=True,
        extra_vertex_groups=True,
        feet_on_ground=True,
        scale=0.1,
    )
    metarig = HumanService.add_builtin_rig(
        rigify_mesh, "rigify.human_toes", import_weights=True
    )
    if metarig is None:
        raise RuntimeError("MPFB did not create the Rigify human-with-toes metarig")
    metarig_bones = bone_snapshot(metarig)
    generated = RigService.generate_rigify_rig(metarig, meta_rig_action="delete")
    if generated is None:
        raise RuntimeError("Rigify rejected MPFB's human-with-toes metarig")
    generated_bones = bone_snapshot(generated)
    rigify_result = {
        "metarigIdentifiedAs": "rigify.human_toes",
        "metarigBones": len(metarig_bones),
        "generatedIdentifiedAs": RigService.identify_rig(generated),
        "generatedBones": len(generated_bones),
        "generatedDeformBones": sum(
            1 for bone in generated_bones.values() if bone["deform"]
        ),
        "toeControls": sorted(
            name
            for name in generated_bones
            if "toe" in name.lower() and not name.startswith(("ORG-", "DEF-", "MCH-"))
        ),
        "footControls": sorted(
            name
            for name in generated_bones
            if "foot" in name.lower() and not name.startswith(("ORG-", "DEF-", "MCH-"))
        ),
        "weights": weight_snapshot(rigify_mesh),
    }

    result = {
        "schemaVersion": 1,
        "status": "pass",
        "blender": bpy.app.version_string,
        "mpfb": {
            "module": mpfb_module_name,
            "version": ".".join(str(value) for value in mpfb.VERSION),
            "packagePath": os.path.dirname(mpfb.__file__),
        },
        "rigify": {"enabled": True},
        "sources": sources,
        "default": default_result,
        "rigifyHumanToes": rigify_result,
    }
    report_path = os.path.join(output, "mpfb-rig-audit.json")
    with open(report_path, "w", encoding="utf-8") as target:
        json.dump(result, target, indent=2, sort_keys=True)
        target.write("\n")
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(output, "mpfb-rigify-human-toes.blend"))
    print("VIDEOER_MPFB_RIG_AUDIT", report_path)


main()
