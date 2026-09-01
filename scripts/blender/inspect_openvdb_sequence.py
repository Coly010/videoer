import hashlib
import json
import os
import struct
import sys

import bpy
import numpy as np
import openvdb


def canonical_grid_digest(path, grid_names):
    digest = hashlib.sha256()
    grid_reports = []
    for name in grid_names:
        grid = openvdb.read(path, name)
        minimum, maximum = grid.evalActiveVoxelBoundingBox()
        shape = tuple(maximum[axis] - minimum[axis] + 1 for axis in range(3))
        values = np.zeros(shape, dtype="<f4")
        grid.copyToArray(values, ijk=minimum)
        voxel_size = tuple(float(value) for value in grid.transform.voxelSize())
        digest.update(name.encode("utf8"))
        digest.update(struct.pack("<3i3i3d", *minimum, *maximum, *voxel_size))
        digest.update(values.tobytes(order="C"))
        grid_reports.append({
            "name": name,
            "activeVoxelBoundingBox": [list(minimum), list(maximum)],
            "voxelSize": list(voxel_size),
            "activeVoxelCount": grid.activeVoxelCount(),
        })
    return digest.hexdigest(), grid_reports


def main():
    arguments = sys.argv[sys.argv.index("--") + 1 :]
    if len(arguments) != 1:
        raise SystemExit("Usage: inspect_openvdb_sequence.py -- <sequence-directory>")
    directory = os.path.abspath(arguments[0])
    paths = sorted(
        os.path.join(directory, name)
        for name in os.listdir(directory)
        if name.endswith(".vdb")
    )
    if not paths:
        raise RuntimeError(f"No OpenVDB files found in {directory}")
    frames = []
    for path in paths:
        field_sha256, grids = canonical_grid_digest(path, ["density", "temperature"])
        frames.append({
            "file": os.path.basename(path),
            "fieldSha256": field_sha256,
            "grids": grids,
        })
    report = {
        "schemaVersion": 1,
        "blenderVersion": bpy.app.version_string,
        "directory": directory,
        "frames": frames,
    }
    print(f"VIDEOER_OPENVDB_INSPECTION={json.dumps(report, separators=(',', ':'))}")


main()
