# ADR 045: Portable projecting signage with replaceable content

## Status

Accepted — 2026-09-01

## Context

The old-city environment contained a private sign assembled from boxes and five gilded strokes. Its hardware, panel, and content were fused into one environment mesh; it had no mounting clearance, two-sided face contract, replaceable campaign treatment, transfer evidence, or reusable identity. That was sufficient as distant set dressing but not as accumulating production inventory.

## Decision

Projecting signage is a portable prop with independent hardware, board, content, host, and attachment semantics.

The shared geometry layer now supports circular tubes swept through open or closed renderer-independent paths. Open paths create continuous bracket rails without overlapping capsule joints. Closed paths create explicit chain links without renderer-specific curve objects. The same primitive can later support railings, cables, decorative ironwork, hoses, and secondary piping.

`prop.projecting-hanging-sign` contains a wall plate, smooth upper rail, triangular lower brace, ten alternating closed chain links, independent two-sided frame members, weathered board, and raised content on both physical faces. The canonical content is a neutral open-book emblem made from two raised page surfaces, page outlines, and a central fold.

The content contract explicitly allows a campaign to replace the bounded two-sided face treatment while requiring the mounting hardware to remain independent. Named attachments expose wall mounts, both hanging pivots, both sign faces, content centre, and focus point. The host contract requires a vertical facade, a bounded mount-height range, and a clear projecting volume.

## Verification and acceptance

The exact portable geometry is rendered at three production-clean Cycles landmarks against an old-city plaster/timber bookshop and an adaptive-reuse brick/steel cafe. The views expose the front face, bracket/load path, projection from the facade, chain silhouette, and back face.

V1 was rejected because its outline read as a diamond. V2 was rejected because the revised outline still read as a shield. V3 adds physical contrasting page surfaces and a central fold and is accepted for background/medium use.

Acceptance reopens the live mesh and independently locates two bounded `sign-emblem-page` triangle groups on opposite X faces. It compares the persisted content contract with geometry metadata, verifies opposed face attachments and every mount/pivot/content attachment, checks both host height/clearance contracts, requires exact geometry reuse, hashes three distinct frames per host, runs every render gate, and requires an accountable qualitative review.

## Consequences

Later trailers can reuse the verified sign hardware and replace the face treatment instead of rebuilding the complete prop. Arbitrary typography, texture baking, localisation, campaign-logo fitting, wind-driven hinge motion, chain dynamics, welds, fasteners, and close-range damage remain future capabilities rather than implied support.

The benchmark's private sign geometry remains legacy until the old-city environment is migrated to placed library instances. It must not be treated as equivalent to the verified portable asset.
