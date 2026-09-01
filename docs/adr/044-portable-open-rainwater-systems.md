# ADR 044: Portable open rainwater systems

## Status

Accepted — 2026-09-01

## Context

The old-city environment contained four private drainpipe fragments made from capped capsules. They supplied distant vertical detail but had no gutter, collection path, mounting contract, transfer evidence, or reusable asset identity. Treating those fragments as finished drainage would preserve a benchmark-specific visual shortcut and prevent later environments from searching, placing, adapting, or verifying the assembly.

## Decision

Rainwater hardware is a first-class portable prop with renderer-independent geometry, material, host, attachment, and water-path semantics.

The shared geometry layer provides a thick-walled half-round trough whose top aperture remains physically open. It contains separate outer and inner walls, lip thickness, annular ends, and no triangle spanning the collection opening. A reusable rectangular-frustum primitive supports manufactured transitions such as collectors and hoppers without stacked-box approximations.

`prop.architectural-rainwater-system` composes the open trough with rolled lips, visible eave brackets, a tapered collector, wall-clipped downpipe, and discharge shoe. Parameters control span, eave height, lower clearance, outlet side, gutter radius, pipe radius, and facade plane. Named attachments expose both eave ends, upper/lower wall mounts, the downpipe outlet, and an exterior focus point.

The host contract requires a straight continuous facade/eave plane, sufficient clear span, the declared eave height, and lower clearance. It does not silently cut, move, or invent host architecture. The same canonical geometry is rendered unchanged against old-city plaster/timber and contemporary concrete/steel witnesses.

The asset embeds a project-owned metre-scaled patinated-copper surface contract. The material uses procedural palette, micro-normal, roughness variation, metallic response, vertical runoff, and bounded dirt semantics; persisted assets contain no Blender node names.

## Verification and acceptance

Generation produces three production-clean Cycles landmarks per host. Gates require the authoritative camera contract, whole-frame visibility, whole-frame and subject-local highlight retention, and complete subject framing.

Acceptance reopens the live geometry and independently rejects any triangle that bridges the inner top aperture. It also verifies the embedded surface against the persisted surface definition, metallic/weathering semantics, named attachments, exact portable-geometry reuse, both host contracts, distinct landmark hashes, every render gate, and an explicit qualitative review.

V1 was rejected for cropping. V2 passed mechanical gates but was visually rejected because the opening was insufficiently legible and the stepped collector remained blockout-like. V3 introduced rolled lips, a tapered collector, and an elevated proof angle but failed the two-percent framing margin at the discharge shoe. V4 corrected that composition and is accepted for background/medium shots.

## Consequences

Campaigns can reuse a coherent drainage assembly rather than fusing pipe fragments into each environment. The asset is not accepted for close/hero-close hardware inspection and does not yet model gutter fall, expansion joints, seams, dents, blockage, overflow, or fluid flow. Those are explicit future capabilities rather than implied by the current geometry.

The private old-city capsule drainpipes remain legacy geometry until the environment is migrated to placed library instances. They must not be treated as equivalent to the verified rainwater system.
