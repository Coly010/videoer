# ADR 030: Renderer-independent temporal clothing correction

## Status

Accepted.

## Context

Static skin-weight checks are necessary but not sufficient for animated clothing. The original long-dress weighting passed normalized-weight and hem-influence checks yet could put a foot behind the skirt surface, pull the skirt into a leg-driven fan, or create a silhouette that was implausible between a few visually sampled frames. A renderer image alone also cannot reliably distinguish a shaded cloth facet from body penetration.

Fixing one benchmark walk by widening its dress, hiding a limb, changing a camera, or adding Blender-only simulation would overfit the evidence and leave other characters, motions, renderers, and campaigns exposed.

## Decision

Temporal clothing is a renderer-independent geometry-and-motion derivation.

For each garment/body/motion tuple, Videoer:

1. samples the complete motion on a fixed temporal grid;
2. deforms the real skinned garment and body on the CPU;
3. derives bilateral arm, leg, foot, and toe collision capsules from the body's actual rest geometry rather than character-specific dimensions;
4. measures penetration depth and frequency, lateral/depth/area silhouette expansion, adjacent-frame area change, and local edge stretch/compression;
5. fails closed when anatomy, skinning, garment regions, or collision proxies are incomplete;
6. when required, solves deterministic pose-space corrections with collision, structural-edge, bending, and waistband-anchor constraints; and
7. stores those corrections as ordinary sparse morph targets and scalar motion tracks consumed unchanged by the Blender and Three.js adapters.

The scene builder content-addresses a derived deformation by the SHA-256 hashes of target garment geometry, body geometry, and motion. An identical tuple is solved once, persisted in the repository-level `.videoer-cache/deformations`, and reused by every shot, later build, or campaign that binds it. A cache hit is accepted only after its three input hashes, geometry/motion compatibility, and live temporal verification pass again. The report records all three input hashes, raw failure, correction evidence, and final verification. Entity names, shot IDs, campaign IDs, character names, genres, cameras, and aspect ratios are not derivation inputs.

Character and standalone fitted-clothing generators run the same temporal checks for neutral and cautious reference gaits before producing verified assets. Generated character geometry embeds its source asset version so extracted clothing can declare exact compatibility lineage; legacy geometry must supply that version explicitly.

## Rejected approaches

- Enlarging the skirt until the motion no longer intersects it: rejected because it changed the designed silhouette and merely moved the failure boundary.
- Sparse collision pushes without shape constraints: rejected because they produced dents and faceting.
- Laplacian spreading alone: rejected after excessive local edge stretch.
- Structural constraints without bending constraints: rejected because the result formed accordion-like hinge folds.
- A hard-pinned waistband: rejected after a held body-turn placed a forearm 26.6 mm inside the upper skirt proxy; allowing collision displacement only at the pinned vertex removed penetration but stretched one local edge to 2.01×. The accepted soft positional waistband tether lets structural and bending constraints distribute the correction and reduced the same pair to 1.035× maximum stretch with zero collision.
- A percentile body radius: rejected because omitted body vertices could still penetrate; collision proxies use the maximum measured radius plus clearance.
- Renderer-only cloth simulation: rejected as the verification and persisted result would depend on one backend and machine.

## Consequences

The benchmark benefits from this subsystem but does not own it. The same derivation runs for integrated clothing and independent wardrobe entities in any declarative campaign, and corrected artifacts can be reused across repeated shots without repeated solving. New motion styles and garment classes still require appropriate material-region selection, collision topology, constraints, and thresholds; they may not claim this long-dress contract by name without passing its verification.

The accepted Elara 0.1.4 evidence samples 49 poses per gait, 231 skirt vertices, and eight body capsules. Both neutral and cautious corrected motions report zero colliding vertex samples while remaining within the declared silhouette and local-strain bounds. These figures are release evidence, not hard-coded character assumptions.
