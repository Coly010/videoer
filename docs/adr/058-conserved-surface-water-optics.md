# ADR 058: Conserved surface-water optical reconstruction

## Status

Accepted

## Context

The static receiver-water solver conserves rain volume on a regular sampling grid. Its first renderer experiment exposed individual cells as transparent quads and was rejected. A continuous texture correctly handles absorbed water, thin film, edge retention and wet roughness, but a texture alone cannot provide the reflective top surface and depth silhouette of macroscopic puddles.

Renderer-local smoothing would make different backends disagree about puddle extent and could silently create or remove water volume.

## Decision

Videoer reconstructs a renderer-independent optical surface from the exact conserved `SurfaceWaterField`:

- only macroscopic `puddleDepthMeters` becomes geometry; absorbed water, film and edge retention remain receiver-material responses;
- cell-centred depths are averaged onto a shared height lattice;
- deterministic alternating triangulation and contour clipping produce interpolated, non-grid-aligned boundaries;
- vertices are deduplicated into one indexed surface rather than one object or quad per solver cell;
- a bounded global depth correction makes integrated projected-area volume match the solver's puddle volume exactly;
- ground height, optical offset and water depth remain separate verified attributes;
- reconstruction options and output are content-addressed and bind the exact source-field semantic hash.

Cinematic environment entities may reference the surface only alongside its source field. Scene verification reconstructs the expected surface and checks live field, geometry and transform evidence. Fingerprinting includes the surface as a transitive render dependency.

Blender consumes the portable mesh without recomputing it. Cycles uses a shallow transmissive dielectric. Eevee uses a thin alpha-blended reflective film over the existing wet receiver because its real-time transmission path otherwise renders the shallow overlay as an opaque grey sheet. Both preserve the same geometry and conserved depth semantics.

## Consequences

- Smooth boundaries are stable across renderers and no longer expose solver cells.
- Optical rendering cannot falsify the solver's conserved puddle volume.
- The surface does not attempt fluid dynamics, ripples or displacement of individual paving stones.
- Production acceptance still depends on suitable environment reflection/lighting and host materials; a valid puddle mesh can be visually illegible in a black, reflection-poor audit world.
