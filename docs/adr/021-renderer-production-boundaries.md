# ADR 021: Production renderer boundaries

Status: Accepted

## Decision

- Remotion owns delivery timeline, shot sequencing, transitions, audio, captions, typography, UI/product layers, and final composition.
- React DOM owns ordinary deterministic 2D layers.
- PixiJS owns dense deterministic screen-space sprites, particles, masks, displacement, and 2D VFX behind the scene registry.
- Three.js owns programmable runtime 3D scene graphs, cameras, lights, materials, skinned characters, morphs, and previews behind a `three-3d` backend adapter.
- Blender headless owns offline mesh processing, rig/constraint assistance, simulation, conversion, and high-quality rendering where selected by the production plan.
- FFmpeg owns diagnostics, frame extraction, audio/muxing, encoding, conversion, and media-level verification.

Stored campaigns, production plans, assets, geometry, characters, motion, and interactions use Videoer domain concepts. No backend owns the application model. Backend selection is an execution decision recorded in generated artifacts and provenance.

## Consequences

Existing marketing, slideshow, screenshot, UI, kinetic text, image motion, scene-keyframe, and 2D scene shots remain supported. 3D extends the central scene graph rather than replacing these paths.
