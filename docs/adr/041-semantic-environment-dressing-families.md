# ADR 041: Semantic environment-dressing families

## Status

Accepted.

## Context

The old-city generator already contained useful windows, eaves, crates, lanterns, signs, drainage and street furniture, but most dressing existed as anonymous mesh parts fused into one environment. Those parts could not be searched, versioned, placed, transferred or visually accepted independently. Merely scattering independently generated props would make the library larger while producing synthetic, obstructive sets.

## Decision

A dressing family is a renderer-independent environment asset whose members are explicit stable prop IDs and immutable versions. Each variant declares selection weight, ground footprint, height, bounded scale, yaw range and semantic tags. The family also declares weighted cluster recipes. Recipes compose named variants through local offsets, relative yaw and scale, allowing intentional arrangements such as barrel pairs, mixed storage caches and crate stacks without merging the resulting scene entities.

Layout requests declare a deterministic seed, a flat ground-plane zone, a cluster count and explicit rectangle or corridor exclusions. The solver rejects placements that intersect exclusions or previously accepted clusters and persists ordinary per-member transforms. A family that promises navigation preservation must receive at least one exclusion; it cannot infer that an empty centre is safe. Sloped-ground placement is not claimed until a future surface-query contract can evaluate height and normal at each member.

Environment-generation output remains editable: every member is an ordinary scene entity referencing its prop identity and version. Cluster identity and recipe provenance are retained for later removal, adaptation or interaction.

Acceptance independently regenerates each persisted layout and requires byte-equivalent structured output, valid member geometry, ground/stack attachments, three distinct landmark frames, complete renderer checks and at least one fully framed useful-scale view for every generated member. Both a stylistically related set and an unrelated set are required. Contact-sheet extraction uses exact decoded frame indices rather than timestamp seeking so short evidence clips cannot silently duplicate landmarks.

## Rejected approaches

- Keep crates and barrels fused into the bookshop mesh: rejected because successful work would remain inaccessible to other campaigns.
- Uniform independent scatter: rejected after the first probe read as anonymous random objects rather than habitation.
- Claim terrain slope support from an unused numeric limit: rejected; the first accepted contract is explicitly flat-ground only.
- Trust landmark probes with empty render checks: rejected after inspection showed that probe mode did not execute declared gates.
- Accept cropped members because whole-frame exposure passed: rejected; `entity-set-coverage` now requires every member to be inspectable in at least one landmark.

## Consequences

`prop.storage-barrel@0.1.0`, `prop.slatted-storage-crate@0.1.0` and `environment.street-storage-family@0.1.0` are the first published inventory using this contract. They are accepted for background/medium shots, not hero close-ups. Future families can add market goods, workshop clutter, domestic objects, vegetation, signage and debris while reusing the same deterministic layout, navigation and acceptance machinery.
