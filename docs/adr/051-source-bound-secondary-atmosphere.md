# ADR 051: Source-bound secondary atmosphere

## Status

Accepted.

## Context

Existing atmospheric VFX covered camera-depth rain/fog in Blender and screen-space smoke, embers and dust in Pixi. Screen-space particles cannot establish world-source attachment, geometry occlusion or true scene depth. A forge, candle, exhaust, impact or dusty opening needs an effect origin that follows a named point on live scene geometry without storing Blender objects or shot-local world coordinates.

## Decision

The renderer-independent VFX model owns discriminated `smoke-volume`, `ember-particles` and `dust-motes` layers. Each layer declares a deterministic seed, count, source-relative origin, spatial extent, lifetime, velocity/wind/turbulence ranges, colour and opacity plus kind-specific physical parameters. Scene resolution binds the VFX asset to a source entity and named geometry attachment, applies the entity world transform and persists both the source identity and resolved world origin.

Blender reconstructs individualized animated 3D embers and sparse OpenVDB density/temperature sequences, then loads those files as renderer-native volume objects. The project-owned smoke solver maintains an evolving three-dimensional velocity field, semi-Lagrangian advection, temperature-driven buoyancy, divergence-free multiscale forcing, vorticity confinement and an iterative pressure projection. It is not a sequence of analytic envelopes or camera-facing sprites.

The backend writes an aerosol report containing the source asset/entity/geometry/attachment, origin distance, declared counts, generated elements, solver parameters, sparse voxel statistics and every raw VDB file hash. Acceptance independently opens every VDB through Blender's bundled OSS OpenVDB module, extracts density and temperature fields, computes canonical field hashes, and requires the two unrelated hosts to reproduce the same fields. Raw VDB container hashes are still checked against the live files for tamper detection, but are not compared across independent writes because OpenVDB serialization includes nondeterministic container data. Probe mode renders only semantic landmarks for iteration; authoritative acceptance requires the complete declared temporal render.

## Visual experiment result

V1 overlapping volume spheres were slow and read as dark balls. V2-v4 consolidated smoke into one heterogeneous ellipsoid, but it was first imperceptible and then a glowing capsule. V5 used one deterministic tapered, drifting irregular volume envelope and preserved credible restrained embers, but the smoke still read as a translucent procedural ribbon. It was rejected and remains unpublished.

The attachment, deterministic-particle, depth/occlusion and report contracts were retained. The first sparse-VDB probe proved changing grids but was visually imperceptible. Extinction calibration made the field visible but exposed a narrow translucent column. Pulsed parcels alone did not create convincing turbulence. The accepted solver then added a persistent incompressible velocity field, buoyancy, vorticity confinement and pressure projection; separated curling billows became visible in both the historic forge and contemporary metal shop.

The first complete two-host render still failed because the contemporary frontal camera framed its source at 30.45% against the unchanged 30% maximum. The camera moved 0.25 metres back rather than weakening the gate. The accepted V7 evidence renders all 12 frames in both hosts, passes framing/visibility/highlight gates, and has an explicit medium-shot review. `vfx.source-bound-smoke-embers@0.1.0` is published for medium/background source smoke. Its approximately 4.6 cm grid, half-second fixture, simplified ember points and lack of collision/combustion chemistry are not hero-close certification.

## Consequences

- Campaign data remains independent of Pixi, Three.js and Blender classes.
- Effects follow live source geometry and can be verified against their declared attachment.
- Embers, dust and future fluid smoke share source semantics without sharing an inappropriate visual representation.
- An architecturally useful experiment may remain unpublished when its rendered representation is not production credible.
- Production machines must provide Blender's bundled `openvdb` and `numpy` modules; `video doctor` verifies both.
- Byte-identical VDB containers are not used as cross-run determinism evidence. Canonical live density/temperature field hashes are authoritative, while raw hashes bind each persisted file to its report.
