# ADR 039: First-class modular hair assets

## Status

Accepted.

## Context

Character definitions referred to hair, but the only implementation was a head-weighted scalp mass fused into character generation. The asset library had no `hair` kind. That prevented independent provenance, fitting, style reuse, material evolution, verification, and eventual secondary motion.

## Decision

Hair is a first-class asset kind with its own immutable library directory and production requirements. A hair definition records representation, canonical skeleton compatibility, anchor joint, target-derived fit dimensions and clearance, material response, provenance, and verification. Hair geometry is stored separately from character topology and may be composed as another canonical-skeleton entity.

The accepted implementation supports a dedicated parametric scalp, narrow high-resolution strand-group cards following great-circle crown-to-nape paths, a separate low-bun mass with surface ribbons, and a renderer-independent UV hair-flow material with strand frequency, colour variation, normal strength, roughness, anisotropy, and specular-response control. Blender reconstructs those material semantics but does not own the persistent definition. Fitted verification renders the unchanged target and hair as separate entities from front, both three-quarter sides, and rear.

Successful geometry and rendering produce only a `validated` candidate. Acceptance independently reloads the definition and geometry, requires exclusive head ownership, verifies four canonical fitted views and renderer checks, requires a distinct target hash and second character fit, and binds an explicit qualitative review. Shot-distance acceptance is explicit. This mesh-card style is accepted for medium/background work but cannot claim hero/close-up quality without individual strand fidelity, flyaways, secondary motion, collision, and wet-hair response.

## Consequences

V1-v2 proved separability but were rejected for incomplete caps, hoop-like ellipsoid locks, and plate-like flow ribbons. V3 moved flow into the material and used target scalp topology. V4 added ear clearance, curved hairline, restrained response, and rear evidence. V5 introduced continuous triangle clipping with interpolated normals/UVs and corrected the bun volume. V6 added asymmetric hairline shaping and a gathered nape mass but remained an unpublished smooth-cap proxy.

V7-v13 evolved the same contract rather than creating a parallel system. They were rejected in sequence for a pale headband, exposed/intersecting scalp, zebra-like wide cards, wire-cage bun bands, incorrect horizontal flow, inconsistent shader response, and dashed card segments caused by polygon chords falling through the scalp. V14 uses 72 narrow 24-segment cards, curvature-safe lift, one coherent material, an expanded fitted scalp envelope, and surface ribbons rather than tubes on the bun. It passes the stable CC0 production template and a distinct project-owned articulated-human transfer.

`hair.pulled-back-low-bun@0.7.0` is verified and published for medium/background use. More expensive Blender strand/groom and simulation systems remain optional backends for shots that justify them, not foundational stored data.
