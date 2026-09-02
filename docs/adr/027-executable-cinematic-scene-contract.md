# ADR 027: Renderer-independent executable cinematic scene contract

## Status

Accepted on 2026-08-30.

**Narrowed by [ADR 072](072-pragmatic-production-realignment.md):** valid for the Blender path
specifically; not required for every 3D or composited shot.

## Context

Verified characters, motions, props, and environments do not by themselves prove that a shot works. Passing isolated probes previously allowed spatially wrong travel, hidden interaction contact, disconnected staging, and timing drift to survive until visual review. Embedding those decisions only in a Blender script would make the production model backend-specific and difficult to validate before rendering.

## Decision

- Persist a renderer-independent scene manifest containing entity roles and transforms, retimed motion intervals, animated camera, lights, deterministic atmosphere, semantic landmarks, and typed quality gates.
- Resolve relative asset paths only at the renderer boundary. The persisted source remains portable and Blender receives a separate resolved manifest.
- Reject non-frame-aligned shot durations. Map the motion and camera endpoint onto the last delivery frame so encoded duration exactly equals the declared duration.
- Require explicit directional-motion checks for locomoting actors. Compare transformed root displacement to transformed canonical forward rather than inferring direction from screen movement.
- Require explicit axis-crossing checks for spatial transitions such as the bookshop threshold.
- Treat semantic contact sheets as evidence. A camera that occludes the hand/handle relationship fails visual acceptance even when upstream numeric contact is correct.
- Keep rendering and verification deterministic and provider-free. Blender may add no unstated geometry, motion, or generated content.

## Consequences

The benchmark can now execute accepted assets inside the same continuous set, and the resulting MP4, Blender source, semantic frames, media metadata, and quality measurements share one auditable scene input. The first two integrated shots exist, but this contract does not claim completion of the full eight-shot edit, production materials, identity refinement, audio, titles, or delivery assembly.
