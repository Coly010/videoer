# ADR 029: Cross-domain derived asset contracts

## Status

Accepted.

**Narrowed by [ADR 072](072-pragmatic-production-realignment.md):** adaptation/publication
contracts remain available; transfer is optional evidence, not a completion criterion.

## Context

The benchmark established reusable geometry, motion, speech, scene, and publication mechanics, but those contracts did not yet make atmospheric VFX, surface materials, or fitted clothing reusable derivation domains. Leaving those decisions embedded in a campaign would make later trailers repeat the same implementation work and would reward visual success without proving transferability.

Library metadata also checked that artifacts existed but did not require a digest for every reusable artifact and verification file. That made a review package less durable than the semantic approval rules built on top of it.

## Decision

Every verified or deprecated library version must declare a SHA-256 digest for every artifact and verification file. Asset-producing application operations use the shared hashed-metadata writer, and migration/audit uses the same validator over the complete inventory.

Atmospheric VFX, surface materials, and canonical clothing are first-class declarative sources:

- An `atmospheric-treatment` derives bounded world, fog, and rain appearance while preserving camera-relative placement, three ordered depth bands, layer IDs, seeds, depth intervals, and spans.
- A `surface-treatment` derives palette, roughness, bump, and related renderer-independent shading parameters while preserving the material model and declared structural contract. Geometry binds the complete material contract, and Blender deterministically translates it into shader nodes.
- A `canonical-clothing-fit` retargets a verified garment to an exact canonical target skeleton, preserves mesh topology and material groups, and applies measured outward normal clearance. Long dresses may use `long-dress-drape-v1`, which makes the pelvis dominant and bounds non-pelvis hem influence to prevent leg-driven skirt fanning.

Each derivation writes a compatibility report containing live parent, target where applicable, and derived hashes plus domain invariants and measurements. Publication approval loads the live artifacts and independently repeats semantic validation after ordinary hash checks. Rewriting candidate content, its report, and every declared digest must still fail approval if protected semantics changed.

Clothing is composed as a separate animated wardrobe entity sharing the actor's exact transform and motion binding. Material bindings embed the renderer-independent surface definition into geometry. Shots reference resolved VFX sources rather than copying atmosphere values.

Geometry publication types are explicitly allowlisted as character, environment, prop, or clothing. Adding a new publication domain must not accidentally make it valid for an unrelated source schema.

## Consequences

Campaign YAML carries creative choices and capability requirements; generic application operations carry resolution, derivation, composition, evidence, and publication mechanics. New campaigns can directly reuse an approved VFX treatment, surface, or fitted garment, or derive a bounded new version without adding campaign-specific orchestration code.

The Rainwalk Square conformance campaign adapts and publishes one asset in each new domain. Rainwalk Banner then resolves those exact three immutable releases in a different aspect ratio and duration with zero VFX, material, or clothing adaptation. Its camera still required format-specific creative framing, demonstrating that reusable mechanics reduce engineering effort without pretending that creative decisions disappear.

The additional contracts and semantic approval checks increase implementation and test cost. That cost is intentional: a reusable asset is only useful when its lineage, compatibility, visual role, and rendered behavior remain trustworthy across campaigns.
