# Production-human retopology research

## Purpose

This research belongs to the reusable character compiler, not to the reference benchmark. Any accepted route must turn a renderer-independent anatomical source into deformation-suitable topology for arbitrary identities, proportions, wardrobes, motions, trailers, and campaigns.

## Blender 4.5.13 QuadriFlow experiment

The project-owned implicit body was tested directly and after Blender's 12 mm voxel remesh. Both inputs were independently measured as:

- one connected component;
- zero boundary and non-manifold edges or vertices;
- zero degenerate faces;
- zero face-orientation conflicts; and
- positive signed volume.

The voxel result contained 22,238 vertices and 22,236 faces. Blender's headless QuadriFlow operator nevertheless cancelled both inputs with its generic manifold/orientation warning. A UV sphere passed the same operator, so the invocation itself works. Explicit duplicate removal, normal recalculation, mesh validation, symmetry removal, and voxel reconstruction did not change the rejection.

## Decision

QuadriFlow is rejected as a production dependency for this compiler. Its failure is not treated as evidence that the renderer-independent source is invalid, and its warning is not bypassed. The experimental script remains diagnostic and now returns a real non-zero process status on Blender Python failure.

The production route is project-owned anatomical topology. Version 2 begins with an additive articulated-hand subsystem: stable core hand IDs, 30 named finger joints, generated palm/finger surfaces, deterministic dual-quaternion weights, per-bone geometry ownership, flexion response, and mandatory bilateral close-up evidence. This is a reusable capability, not a benchmark mesh edit.

## Hand scale and posed evidence

The v2 proportions use public anthropometric measurements as a scale constraint, not as an identity or sex classifier. NASA's 1,190-subject Navy-pilot table reports a 7.6 inch mean hand length and 3.3 inch mean breadth, while a NIOSH hand study defines length from wrist crease to middle fingertip and breadth across the metacarpals and reports 185–197 mm lengths and 88–97 mm breadths for its 175–185 cm subjects. Population, sex, and individual variation remain parameters; these values only prevent the procedural fixture from drifting into a childlike 145 mm hand.

- NASA source: https://ntrs.nasa.gov/api/citations/19710016468/downloads/19710016468.pdf
- NIOSH/CDC source: https://stacks.cdc.gov/view/cdc/189869/cdc_189869_DS1.pdf

The first v2 render remains visually rejected. It proves five distinct digits and real articulation. Subsequent revisions removed radial palm-centre spokes, corrected wrist-to-tip scale, added per-phalanx blend requirements, flattened audited nail landmarks, added bilateral rest/flexion renders, contained finger weights to knuckle zones, and corrected Blender's arbitrary leaf-bone orientation. The current fingers remain uniformly tubular, the palm remains inflated, the wrist/webbing transitions are too soft, thumb opposition is shallow, and knuckle, cuticle, tendon, and crease landmarks are not production quality.

The current rejection is content-addressed at `campaigns/reference-cinematic-benchmark/work/characters/production-human-articulated-v0.2.0/verification/hand-visual-review.json`. Any geometry, validation, rest-view, or flexion-view change makes that review stale.
