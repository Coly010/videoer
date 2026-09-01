# ADR 019: Renderer-independent procedural geometry

Status: Accepted for implementation

## Decision

Videoer will own a serializable indexed-mesh representation containing positions, normals, indices, UVs, vertex colours, skin indices/weights, morph targets, named attachment points, units, coordinate convention, and bounds. Generator requests use domain primitives and operations—curves, parametric surfaces, extrusion, transform, merge, mirror, and deformation—not Three.js or Blender classes.

Pure TypeScript generators and validators are the canonical deterministic core. Three.js is the interactive/runtime adapter. Blender headless is the offline adapter for operations it materially implements better, including robust booleans, conversion, rig/constraint work, simulation, and high-quality probes. Adapter round trips must preserve stable names, scale, orientation, materials, skeleton semantics, and attachment points.

Geometry validation will reject NaNs, invalid indices, degenerate triangles, invalid weights, and extreme bounds; backend-assisted checks will add manifold and surface diagnostics where necessary.

The production-human experiment adds a renderer-independent signed-distance mesher based on consistently split marching tetrahedra. It welds sub-0.1-millimetre corner intersections, emits indexed manifold topology, analytic gradient normals, UVs, and skin attributes, and does not depend on Three.js or Blender classes. This replaces the overlapping-capsule study as the body-volume foundation while preserving capsules as ordinary primitives for props and early mechanical fixtures.

## Consequences

The first objective fixture is a project-owned procedural humanoid mannequin, not a photorealistic person. The continuous implicit surface proves the geometry and deformation architecture but is still visually rejected; it does not convert a body-volume generator into production character art. No campaign file stores `THREE.*` or Blender Python implementation types.
