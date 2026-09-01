import hashlib
import math
import os
import random

import bpy
import numpy as np
import openvdb
from mathutils import Vector


def _sample_trilinear(field, x, y, z):
    nx, ny, nz = field.shape
    valid = (x >= 0) & (x <= nx - 1) & (y >= 0) & (y <= ny - 1) & (z >= 0) & (z <= nz - 1)
    x = np.clip(x, 0, nx - 1.001)
    y = np.clip(y, 0, ny - 1.001)
    z = np.clip(z, 0, nz - 1.001)
    x0 = np.floor(x).astype(np.int32)
    y0 = np.floor(y).astype(np.int32)
    z0 = np.floor(z).astype(np.int32)
    x1 = np.minimum(x0 + 1, nx - 1)
    y1 = np.minimum(y0 + 1, ny - 1)
    z1 = np.minimum(z0 + 1, nz - 1)
    fx = x - x0
    fy = y - y0
    fz = z - z0
    c00 = field[x0, y0, z0] * (1 - fx) + field[x1, y0, z0] * fx
    c10 = field[x0, y1, z0] * (1 - fx) + field[x1, y1, z0] * fx
    c01 = field[x0, y0, z1] * (1 - fx) + field[x1, y0, z1] * fx
    c11 = field[x0, y1, z1] * (1 - fx) + field[x1, y1, z1] * fx
    c0 = c00 * (1 - fy) + c10 * fy
    c1 = c01 * (1 - fy) + c11 * fy
    return np.where(valid, c0 * (1 - fz) + c1 * fz, 0).astype(np.float32)


def _advect(field, displacement_x, displacement_y, displacement_z, ix, iy, iz):
    return _sample_trilinear(
        field,
        ix - displacement_x,
        iy - displacement_y,
        iz - displacement_z,
    )


def _project_incompressible(
    velocity_x,
    velocity_y,
    velocity_z,
    dt,
    voxel_size,
    iterations=14,
):
    """Project a collocated velocity field to approximately zero divergence.

    Projection is performed in voxel-displacement units. This keeps the
    discrete pressure solve dimensionally stable as scene-scale voxel sizes
    change, then converts the corrected field back to metres per second.
    """
    scale = dt / voxel_size
    displacement_x = velocity_x * scale
    displacement_y = velocity_y * scale
    displacement_z = velocity_z * scale
    divergence = 0.5 * (
        np.roll(displacement_x, -1, axis=0)
        - np.roll(displacement_x, 1, axis=0)
        + np.roll(displacement_y, -1, axis=1)
        - np.roll(displacement_y, 1, axis=1)
        + np.roll(displacement_z, -1, axis=2)
        - np.roll(displacement_z, 1, axis=2)
    )
    divergence[[0, -1], :, :] = 0
    divergence[:, [0, -1], :] = 0
    divergence[:, :, [0, -1]] = 0
    pressure = np.zeros_like(divergence)
    for _ in range(iterations):
        pressure = (
            np.roll(pressure, 1, axis=0)
            + np.roll(pressure, -1, axis=0)
            + np.roll(pressure, 1, axis=1)
            + np.roll(pressure, -1, axis=1)
            + np.roll(pressure, 1, axis=2)
            + np.roll(pressure, -1, axis=2)
            - divergence
        ) / 6.0
        pressure[[0, -1], :, :] = 0
        pressure[:, [0, -1], :] = 0
        pressure[:, :, [0, -1]] = 0
    displacement_x -= 0.5 * (
        np.roll(pressure, -1, axis=0) - np.roll(pressure, 1, axis=0)
    )
    displacement_y -= 0.5 * (
        np.roll(pressure, -1, axis=1) - np.roll(pressure, 1, axis=1)
    )
    displacement_z -= 0.5 * (
        np.roll(pressure, -1, axis=2) - np.roll(pressure, 1, axis=2)
    )
    displacement_x[[0, -1], :, :] = 0
    displacement_y[:, [0, -1], :] = 0
    displacement_z[:, :, [0, -1]] = 0
    post_projection_divergence = 0.5 * (
        np.roll(displacement_x, -1, axis=0)
        - np.roll(displacement_x, 1, axis=0)
        + np.roll(displacement_y, -1, axis=1)
        - np.roll(displacement_y, 1, axis=1)
        + np.roll(displacement_z, -1, axis=2)
        - np.roll(displacement_z, 1, axis=2)
    )
    post_projection_divergence[[0, -1], :, :] = 0
    post_projection_divergence[:, [0, -1], :] = 0
    post_projection_divergence[:, :, [0, -1]] = 0
    inverse_scale = voxel_size / dt
    return (
        displacement_x * inverse_scale,
        displacement_y * inverse_scale,
        displacement_z * inverse_scale,
        float(np.max(np.abs(divergence))),
        float(np.max(np.abs(post_projection_divergence))),
    )


def _apply_vorticity_confinement(velocity_x, velocity_y, velocity_z, strength, dt, voxel_size):
    derivative_scale = 0.5 / voxel_size
    curl_x = (
        np.roll(velocity_z, -1, axis=1)
        - np.roll(velocity_z, 1, axis=1)
        - np.roll(velocity_y, -1, axis=2)
        + np.roll(velocity_y, 1, axis=2)
    ) * derivative_scale
    curl_y = (
        np.roll(velocity_x, -1, axis=2)
        - np.roll(velocity_x, 1, axis=2)
        - np.roll(velocity_z, -1, axis=0)
        + np.roll(velocity_z, 1, axis=0)
    ) * derivative_scale
    curl_z = (
        np.roll(velocity_y, -1, axis=0)
        - np.roll(velocity_y, 1, axis=0)
        - np.roll(velocity_x, -1, axis=1)
        + np.roll(velocity_x, 1, axis=1)
    ) * derivative_scale
    magnitude = np.sqrt(curl_x**2 + curl_y**2 + curl_z**2)
    gradient_x = (
        np.roll(magnitude, -1, axis=0) - np.roll(magnitude, 1, axis=0)
    ) * derivative_scale
    gradient_y = (
        np.roll(magnitude, -1, axis=1) - np.roll(magnitude, 1, axis=1)
    ) * derivative_scale
    gradient_z = (
        np.roll(magnitude, -1, axis=2) - np.roll(magnitude, 1, axis=2)
    ) * derivative_scale
    gradient_length = np.sqrt(gradient_x**2 + gradient_y**2 + gradient_z**2) + 1e-6
    normal_x = gradient_x / gradient_length
    normal_y = gradient_y / gradient_length
    normal_z = gradient_z / gradient_length
    force_x = normal_y * curl_z - normal_z * curl_y
    force_y = normal_z * curl_x - normal_x * curl_z
    force_z = normal_x * curl_y - normal_y * curl_x
    return (
        velocity_x + force_x * strength * dt,
        velocity_y + force_y * strength * dt,
        velocity_z + force_z * strength * dt,
    )


def _write_grid(path, density, temperature, voxel_size, metadata):
    density_grid = openvdb.FloatGrid()
    density_grid.name = "density"
    density_grid.gridClass = openvdb.GridClass.FOG_VOLUME
    density_grid.transform = openvdb.createLinearTransform(voxelSize=voxel_size)
    density_grid.copyFromArray(density.astype(np.float32), tolerance=1e-5)
    temperature_grid = openvdb.FloatGrid()
    temperature_grid.name = "temperature"
    temperature_grid.gridClass = openvdb.GridClass.FOG_VOLUME
    temperature_grid.transform = openvdb.createLinearTransform(voxelSize=voxel_size)
    temperature_grid.copyFromArray(temperature.astype(np.float32), tolerance=1e-5)
    openvdb.write(path, grids=[density_grid, temperature_grid], metadata=metadata)
    with open(path, "rb") as handle:
        digest = hashlib.sha256(handle.read()).hexdigest()
    return {
        "densityActiveVoxels": density_grid.activeVoxelCount(),
        "temperatureActiveVoxels": temperature_grid.activeVoxelCount(),
        "densityMaximum": float(density.max()),
        "densityMeanActive": float(density[density > 1e-5].mean()) if np.any(density > 1e-5) else 0.0,
        "sha256": digest,
    }


def _create_volume_material(layer):
    material = bpy.data.materials.new(f"aerosol-{layer['id']}-openvdb-material")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    volume = nodes.new("ShaderNodeVolumePrincipled")
    volume.inputs["Color"].default_value = (*layer["color"], 1)
    volume.inputs["Anisotropy"].default_value = layer.get("anisotropy", 0.1)
    density_attribute = nodes.new("ShaderNodeAttribute")
    density_attribute.attribute_name = "density"
    density_scale = nodes.new("ShaderNodeMath")
    density_scale.operation = "MULTIPLY"
    # OpenVDB values are simulation concentrations, while Principled Volume's
    # density is extinction per metre. Calibrate the sparse field into a useful
    # cinematic extinction range, then retain asset opacity as a bounded
    # artistic control. Without this conversion a representative active-voxel
    # mean of ~0.03 is effectively transparent even though the VDB is valid.
    density_scale.inputs[1].default_value = layer["density"] * max(
        6.0, layer["opacity"] * 24.0
    )
    links.new(density_attribute.outputs["Fac"], density_scale.inputs[0])
    links.new(density_scale.outputs[0], volume.inputs["Density"])
    links.new(volume.outputs["Volume"], output.inputs["Volume"])
    return material


def create_sparse_smoke_sequence(layer, output, fps, frame_count, to_blender):
    generator = random.Random(layer["seed"])
    voxel_size = min(0.055, max(0.035, layer["noiseScaleMeters"] * 0.24))
    maximum_radius = layer["particleRadiusMeters"]["maximum"]
    horizontal_half = (
        layer["sourceRadiusMeters"]
        + maximum_radius * 1.5
        + layer["turbulenceMeters"] * 1.5
        + max(abs(layer["windMetersPerSecond"][0]), abs(layer["windMetersPerSecond"][2]))
        * layer["lifetimeSeconds"]
    )
    horizontal_half = max(0.72, min(1.45, horizontal_half))
    vertical_span = layer["verticalSpanMeters"] + maximum_radius * 0.6
    nx = max(24, math.ceil(horizontal_half * 2 / voxel_size))
    ny = nx
    nz = max(36, math.ceil(vertical_span / voxel_size))
    shape = (nx, ny, nz)
    ix, iy, iz = np.meshgrid(
        np.arange(nx, dtype=np.float32),
        np.arange(ny, dtype=np.float32),
        np.arange(nz, dtype=np.float32),
        indexing="ij",
    )
    x = (ix + 0.5) * voxel_size - horizontal_half
    y = (iy + 0.5) * voxel_size - horizontal_half
    z = (iz + 0.5) * voxel_size
    density = np.zeros(shape, dtype=np.float32)
    temperature = np.zeros(shape, dtype=np.float32)
    velocity_x = np.zeros(shape, dtype=np.float32)
    velocity_y = np.zeros(shape, dtype=np.float32)
    velocity_z = np.zeros(shape, dtype=np.float32)
    phases = [generator.uniform(0, math.tau) for _ in range(8)]
    parcels = []
    for index in range(layer["count"]):
        angle = generator.uniform(0, math.tau)
        radial = layer["sourceRadiusMeters"] * math.sqrt(generator.random())
        parcels.append({
            "particleIndex": index,
            "offset": [math.cos(angle) * radial, math.sin(angle) * radial],
            "radiusMeters": generator.uniform(
                layer["particleRadiusMeters"]["minimum"],
                layer["particleRadiusMeters"]["maximum"],
            ),
            "phase": generator.uniform(0, math.tau),
            "riseSpeedMetersPerSecond": generator.uniform(
                layer["riseSpeedMetersPerSecond"]["minimum"],
                layer["riseSpeedMetersPerSecond"]["maximum"],
            ),
        })

    dt = 1.0 / fps
    warmup_frames = max(frame_count, round(layer["lifetimeSeconds"] * fps * 0.78))
    directory = os.path.join(output, "aerosol-vdb", layer["id"])
    os.makedirs(directory, exist_ok=True)
    frame_reports = []
    wind = [
        layer["windMetersPerSecond"][0],
        -layer["windMetersPerSecond"][2],
        layer["windMetersPerSecond"][1],
    ]
    base_rise = sum(layer["riseSpeedMetersPerSecond"].values()) * 0.5
    total_steps = warmup_frames + frame_count
    maximum_pre_projection_divergence = 0.0
    maximum_post_projection_divergence = 0.0
    for step in range(total_steps):
        time = step * dt
        height_factor = np.clip(z / max(vertical_span, 1e-6), 0, 1)
        amplitude = layer["turbulenceMeters"] * (0.55 + height_factor * 1.35)
        k1 = math.tau / max(layer["noiseScaleMeters"] * 3.2, voxel_size * 6)
        k2 = k1 * 0.47
        phase_time = time * (0.72 + base_rise * 0.35)
        displacement_x = velocity_x * dt / voxel_size
        displacement_y = velocity_y * dt / voxel_size
        displacement_z = velocity_z * dt / voxel_size
        previous_velocity_x = velocity_x
        previous_velocity_y = velocity_y
        previous_velocity_z = velocity_z
        velocity_x = _advect(
            previous_velocity_x,
            displacement_x,
            displacement_y,
            displacement_z,
            ix,
            iy,
            iz,
        )
        velocity_y = _advect(
            previous_velocity_y,
            displacement_x,
            displacement_y,
            displacement_z,
            ix,
            iy,
            iz,
        )
        velocity_z = _advect(
            previous_velocity_z,
            displacement_x,
            displacement_y,
            displacement_z,
            ix,
            iy,
            iz,
        )

        # Nudge the evolving field toward ambient wind and add divergence-free
        # multi-scale forcing. Unlike the rejected prescribed-flow version,
        # these are accelerations on a persistent velocity field rather than a
        # replacement velocity evaluated independently every frame.
        wind_relaxation = min(1.0, dt * 0.55)
        velocity_x += (wind[0] - velocity_x) * wind_relaxation
        velocity_y += (wind[1] - velocity_y) * wind_relaxation
        velocity_x += (
            amplitude
            * (
                np.sin(y * k1 + phases[0] + phase_time) * np.cos(z * k2 + phases[1])
                + 0.38 * np.sin(y * k2 - phases[2] - phase_time * 0.63)
            )
            * dt
            * 2.4
        )
        velocity_y += (
            amplitude
            * (
                -np.sin(x * k1 + phases[3] - phase_time) * np.cos(z * k2 + phases[4])
                + 0.38 * np.sin(x * k2 + phases[5] + phase_time * 0.57)
            )
            * dt
            * 2.4
        )
        velocity_z += temperature * dt * 1.7
        velocity_z += (
            amplitude
            * 0.55
            * np.sin(x * k2 + phases[6] + phase_time * 0.4)
            * np.sin(y * k2 + phases[7] - phase_time * 0.52)
            * dt
        )
        velocity_x, velocity_y, velocity_z = _apply_vorticity_confinement(
            velocity_x,
            velocity_y,
            velocity_z,
            max(0.12, layer["turbulenceMeters"] * 1.8),
            dt,
            voxel_size,
        )
        (
            velocity_x,
            velocity_y,
            velocity_z,
            pre_projection_divergence,
            post_projection_divergence,
        ) = _project_incompressible(
            velocity_x,
            velocity_y,
            velocity_z,
            dt,
            voxel_size,
        )
        maximum_pre_projection_divergence = max(
            maximum_pre_projection_divergence,
            pre_projection_divergence,
        )
        maximum_post_projection_divergence = max(
            maximum_post_projection_divergence,
            post_projection_divergence,
        )

        displacement_x = velocity_x * dt / voxel_size
        displacement_y = velocity_y * dt / voxel_size
        displacement_z = velocity_z * dt / voxel_size
        density = _advect(
            density,
            displacement_x,
            displacement_y,
            displacement_z,
            ix,
            iy,
            iz,
        ) * 0.989
        temperature = _advect(
            temperature,
            displacement_x,
            displacement_y,
            displacement_z,
            ix,
            iy,
            iz,
        ) * 0.972

        source = np.zeros(shape, dtype=np.float32)
        for parcel in parcels:
            pulse = max(0.0, 0.5 + 0.5 * math.sin(time * 3.4 + parcel["phase"])) ** 2.4
            source_radius = max(layer["sourceRadiusMeters"] * 0.24, parcel["radiusMeters"] * 0.48)
            orbit = min(source_radius * 0.42, layer["sourceRadiusMeters"] * 0.24)
            source_x = parcel["offset"][0] + math.sin(time * 1.7 + parcel["phase"]) * orbit
            source_y = parcel["offset"][1] + math.cos(time * 1.3 + parcel["phase"]) * orbit
            parcel_source = pulse * np.exp(
                -(
                    (x - source_x) ** 2
                    + (y - source_y) ** 2
                )
                / (2 * source_radius**2)
                - ((z - voxel_size * 1.8) ** 2) / (2 * (voxel_size * 1.8) ** 2)
            )
            # Preserve discrete emission parcels. Averaging every source into a
            # single field produced a smooth analytic-looking column even after
            # turbulent advection; a maximum union retains lobe boundaries.
            source = np.maximum(source, parcel_source)
        density = np.clip(density + source * 0.12, 0, 1.5)
        temperature = np.clip(temperature + source * 0.16, 0, 1)
        velocity_z += source * base_rise * 0.18
        if step >= warmup_frames:
            frame = step - warmup_frames + 1
            path = os.path.join(directory, f"{layer['id']}_{frame:04d}.vdb")
            report = _write_grid(
                path,
                density,
                temperature,
                voxel_size,
                {
                    "creator": "Videoer deterministic sparse smoke v2",
                    "layerId": layer["id"],
                    "seed": layer["seed"],
                    "frame": frame,
                },
            )
            frame_reports.append({"frame": frame, "path": os.path.relpath(path, output), **report})

    volume_data = bpy.data.volumes.new(f"aerosol-{layer['id']}-openvdb")
    volume_data.filepath = os.path.join(directory, f"{layer['id']}_0001.vdb")
    volume_data.is_sequence = True
    volume_data.frame_start = 1
    volume_data.frame_duration = frame_count
    volume_data.sequence_mode = "CLIP"
    volume_data.materials.append(_create_volume_material(layer))
    smoke = bpy.data.objects.new(f"aerosol-{layer['id']}-sparse-volume", volume_data)
    bpy.context.collection.objects.link(smoke)
    origin = Vector(to_blender(layer["origin"]))
    smoke.location = origin + Vector((-horizontal_half, -horizontal_half, 0))
    return {
        "representation": "sparse-openvdb-buoyant-incompressible-v3",
        "voxelSizeMeters": voxel_size,
        "gridDimensions": list(shape),
        "warmupFrames": warmup_frames,
        "sequenceFrames": frame_count,
        "solver": {
            "kind": "buoyant-incompressible-grid",
            "pressureIterations": 14,
            "vorticityConfinement": max(0.12, layer["turbulenceMeters"] * 1.8),
            "maximumPreProjectionDivergence": maximum_pre_projection_divergence,
            "maximumPostProjectionDivergence": maximum_post_projection_divergence,
        },
        "domainMinimumBlender": list(smoke.location),
        "sourceParcels": parcels,
        "frames": frame_reports,
    }
